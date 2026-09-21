/**
 * 每日續帳（取代付費方案才有的排程函式）
 *
 * 免費方案沒有 Cloud Scheduler，因此改在「生教組端每天第一次開啟系統」時執行：
 *  1. 紙本反思卡尚未回收者 → 把管制續帳到今天
 *  2. 值勤完成但檢討書未回收者 → 同上；已達解鎖日者不再續帳＝自動解鎖
 *  3. 重建公開看板
 *
 * 以 `systemState/dailySync.lastRunOn` 記錄，每天只跑一次；
 * 若當天沒人開系統，隔天開啟時會一併補上（管制帳以日期為鍵，不會重複）。
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { COL } from '../firestore/paths.js';
import { ASSIGNMENT_STATUS, INFRACTION_STATUS, RESTRICTION_REASONS, type SystemSettings } from '../domain/types.js';
import type { Ctx } from './context.js';
import { freezeRecess } from './restrictions.js';
import { rebuildPublicBoard } from './publicBoard.js';

const STATE_COL = 'systemState';
const STATE_DOC = 'dailySync';

export async function runDailySyncIfNeeded(
  ctx: Ctx,
  settings: SystemSettings,
  options: { force?: boolean } = {},
): Promise<{ ran: boolean; carriedOver: number }> {
  const today = ctx.clock.today();
  const stateRef = doc(ctx.db, STATE_COL, STATE_DOC);
  const stateSnap = await getDoc(stateRef);
  if (!options.force && stateSnap.exists() && stateSnap.get('lastRunOn') === today) {
    return { ran: false, carriedOver: 0 };
  }

  let carriedOver = 0;

  if (settings.carryOverUnfinished) {
    const pending = await getDocs(
      query(
        collection(ctx.db, COL.infractions),
        where('status', '==', INFRACTION_STATUS.OPEN),
        where('occurredOn', '<', today),
        fsLimit(200),
      ),
    );
    for (const docSnap of pending.docs) {
      await freezeRecess(ctx, {
        student: {
          id: docSnap.get('studentId') as string,
          studentNo: docSnap.get('studentNo') as string,
          name: docSnap.get('studentName') as string,
          classId: docSnap.get('classId') as string,
          className: docSnap.get('className') as string,
          seatNo: (docSnap.get('seatNo') as number | null) ?? null,
        },
        date: today,
        reason: RESTRICTION_REASONS.INFRACTION_PAPER,
        periods: [],
        sourceRef: { infractionId: docSnap.id },
        note: `${docSnap.get('occurredOn')} 之紙本反思卡尚未回收，管制續行`,
      });
      carriedOver += 1;
    }
  }

  const waitingReview = await getDocs(
    query(
      collection(ctx.db, COL.observerAssignments),
      where('status', '==', ASSIGNMENT_STATUS.DUTY_COMPLETED),
      fsLimit(100),
    ),
  );
  for (const docSnap of waitingReview.docs) {
    const unlockOn = docSnap.get('unlockOn') as string | null;
    if (unlockOn && today >= unlockOn) continue; // 已達解鎖日 → 不再管制
    await freezeRecess(ctx, {
      student: {
        id: docSnap.get('studentId') as string,
        studentNo: docSnap.get('studentNo') as string,
        name: docSnap.get('studentName') as string,
        classId: docSnap.get('classId') as string,
        className: docSnap.get('className') as string,
      },
      date: today,
      reason: RESTRICTION_REASONS.OBSERVER_REVIEW_PENDING,
      periods: settings.observerPeriodNumbers,
      sourceRef: { assignmentId: docSnap.id },
      note: '紙本行為檢討書尚未回收，管制續行',
    });
    carriedOver += 1;
  }

  await rebuildPublicBoard(ctx, settings);
  await setDoc(
    stateRef,
    { lastRunOn: today, lastRunAt: serverTimestamp(), carriedOver },
    { merge: true },
  );

  return { ran: true, carriedOver };
}
