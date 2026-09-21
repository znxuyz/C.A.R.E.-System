/**
 * 公開唯讀看板
 *
 * 免 Cloud Functions 架構下，由生教組端在每次異動後重建這份摘要，
 * 匿名訪客只讀 `publicBoard/today` 一份文件，接觸不到任何業務集合。
 *
 * 預設只輸出統計數字；`settings.publicBoard.showRoster` 開啟時，
 * 最多只輸出「班級＋座號」，**永不含姓名或學號**。
 */
import {
  collection,
  doc,
  getDocs,
  limit as fsLimit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { COL, PUBLIC_BOARD_DOC } from '../firestore/paths.js';
import { addDays } from '../domain/dates.js';
import { ASSIGNMENT_STATUS, PAPER_CARDS, type SystemSettings } from '../domain/types.js';
import type { Ctx } from './context.js';

export async function rebuildPublicBoard(ctx: Ctx, settings: SystemSettings): Promise<void> {
  const today = ctx.clock.today();
  const since = addDays(today, -13);

  const [restrictionSnap, alertSnap, assignmentSnap, infractionSnap] = await Promise.all([
    getDocs(query(collection(ctx.db, COL.recessRestrictions), where('date', '==', today))),
    getDocs(
      query(
        collection(ctx.db, COL.recidivismAlerts),
        where('status', 'in', ['OPEN', 'ACKNOWLEDGED', 'ASSIGNED']),
        fsLimit(100),
      ),
    ),
    getDocs(query(collection(ctx.db, COL.observerAssignments), where('dutyOn', '==', today))),
    getDocs(
      query(
        collection(ctx.db, COL.infractions),
        where('occurredOn', '>=', since),
        where('occurredOn', '<=', today),
        fsLimit(500),
      ),
    ),
  ]);

  const restrictions = restrictionSnap.docs.filter((d) => d.get('status') === 'ACTIVE');
  const counted = infractionSnap.docs.filter(
    (d) => d.get('status') !== 'VOIDED' && d.get('status') !== 'EXEMPTED',
  );

  const trend = Array.from({ length: 14 }, (_, index) => {
    const date = addDays(today, index - 13);
    const sameDay = counted.filter((d) => d.get('occurredOn') === date);
    return {
      date,
      safety: sameDay.filter((d) => d.get('paperCard') === PAPER_CARDS.SAFETY).length,
      kindWords: sameDay.filter((d) => d.get('paperCard') === PAPER_CARDS.KIND_WORDS).length,
    };
  });

  const hotspots = new Map<string, number>();
  for (const d of counted) {
    const name = (d.get('locationName') as string) ?? '其他';
    hotspots.set(name, (hotspots.get(name) ?? 0) + 1);
  }

  const board: Record<string, unknown> = {
    enabled: settings.publicBoard.enabled,
    date: today,
    updatedAt: serverTimestamp(),
    stats: {
      restrictedCount: restrictions.length,
      openAlerts: alertSnap.size,
      observersToday: assignmentSnap.docs.filter(
        (d) => d.get('status') !== ASSIGNMENT_STATUS.CANCELLED,
      ).length,
      infractionsToday: counted.filter((d) => d.get('occurredOn') === today).length,
      infractions14d: counted.length,
    },
    trend,
    hotspots: [...hotspots.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    roster: null,
    observers: null,
  };

  if (settings.publicBoard.showRoster) {
    board.roster = restrictions
      .map((d) => ({
        className: (d.get('className') as string) ?? '',
        seatNo: (d.get('seatNo') as number | null) ?? null,
        reasons: (d.get('reasons') as string[]) ?? [],
      }))
      .sort((a, b) => a.className.localeCompare(b.className));
    board.observers = assignmentSnap.docs.map((d) => ({
      className: (d.get('className') as string) ?? '',
      seatNo: null,
      periodsDone: ((d.get('periodLogs') as Array<{ checkOutAt?: string }>) ?? []).filter(
        (log) => Boolean(log.checkOutAt),
      ).length,
      totalPeriods: (d.get('totalPeriods') as number) ?? 5,
    }));
  }

  await setDoc(doc(ctx.db, COL.publicBoard, PUBLIC_BOARD_DOC), board);
}
