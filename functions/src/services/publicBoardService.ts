/**
 * 公開唯讀看板
 *
 * 隱私設計（重要）：
 *   前端的公開頁**不直接讀取任何業務集合**，只讀這一份由伺服器產生的
 *   去識別化摘要文件 `publicBoard/today`。因此即使公開頁被任何人開啟，
 *   也無法查詢學生姓名、違規明細或歷程。
 *
 *   預設只公開「統計數字」；若校方確有需要，可於 settings 開啟
 *   `publicBoard.showRoster`，此時最多只輸出「班級＋座號」，
 *   任何情況都不會輸出姓名或學號。
 *
 *   提醒：即使只有班級與座號，校內同學仍可辨識當事人，
 *   等同公開懲戒；開啟前請確認符合校內個資與輔導管教規範。
 */
import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, PUBLIC_BOARD_DOC_ID, col } from '../data/collections.js';
import { loadSettings } from '../data/repositories.js';
import { addDays } from '../domain/dates.js';
import {
  PAPER_CARDS,
  type PublicBoard,
  type RecessRestriction,
  type SchoolDate,
} from '../domain/types.js';
import type { Clock } from '../lib/clock.js';

export async function rebuildPublicBoard(
  firestore: Firestore,
  clock: Clock,
): Promise<PublicBoard> {
  const settings = await loadSettings(firestore);
  const today = clock.today();
  const since = addDays(today, -13);

  const [restrictionSnap, alertSnap, assignmentSnap, infractionSnap] = await Promise.all([
    col(firestore, COLLECTIONS.recessRestrictions).where('date', '==', today).get(),
    col(firestore, COLLECTIONS.recidivismAlerts)
      .where('status', 'in', ['OPEN', 'ACKNOWLEDGED', 'ASSIGNED'])
      .get(),
    col(firestore, COLLECTIONS.observerAssignments).where('dutyOn', '==', today).get(),
    col(firestore, COLLECTIONS.infractions)
      .where('occurredOn', '>=', since)
      .where('occurredOn', '<=', today)
      .get(),
  ]);

  const restrictions = restrictionSnap.docs
    .map((doc) => doc.data() as RecessRestriction)
    .filter((row) => row.status === 'ACTIVE');

  const countedInfractions = infractionSnap.docs.filter(
    (doc) => doc.get('status') !== 'VOIDED' && doc.get('status') !== 'EXEMPTED',
  );

  const trend: PublicBoard['trend'] = [];
  for (let offset = -13; offset <= 0; offset += 1) {
    const date = addDays(today, offset) as SchoolDate;
    const sameDay = countedInfractions.filter((doc) => doc.get('occurredOn') === date);
    trend.push({
      date,
      safety: sameDay.filter((doc) => doc.get('paperCard') === PAPER_CARDS.SAFETY).length,
      kindWords: sameDay.filter((doc) => doc.get('paperCard') === PAPER_CARDS.KIND_WORDS).length,
    });
  }

  const hotspotMap = new Map<string, number>();
  for (const doc of countedInfractions) {
    const name = (doc.get('locationName') as string) ?? '其他';
    hotspotMap.set(name, (hotspotMap.get(name) ?? 0) + 1);
  }

  const board: PublicBoard = {
    date: today,
    updatedAt: clock.now(),
    stats: {
      restrictedCount: restrictions.length,
      openAlerts: alertSnap.size,
      observersToday: assignmentSnap.size,
      infractionsToday: countedInfractions.filter((doc) => doc.get('occurredOn') === today).length,
      infractions14d: countedInfractions.length,
    },
    trend,
    hotspots: [...hotspotMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  };

  if (settings.publicBoard.showRoster) {
    // 僅班級＋座號，絕不含姓名或學號
    board.roster = restrictions
      .map((row) => ({
        className: row.className,
        seatNo: row.seatNo ?? null,
        reasons: row.reasons ?? [],
      }))
      .sort((a, b) => a.className.localeCompare(b.className));
    board.observers = assignmentSnap.docs.map((doc) => ({
      className: doc.get('className') as string,
      seatNo: null,
      periodsDone: ((doc.get('periodLogs') as Array<{ checkOutAt?: string }>) ?? []).filter(
        (log) => Boolean(log.checkOutAt),
      ).length,
      totalPeriods: (doc.get('totalPeriods') as number) ?? 5,
    }));
  }

  await col(firestore, COLLECTIONS.publicBoard)
    .doc(PUBLIC_BOARD_DOC_ID)
    .set({ ...board, enabled: settings.publicBoard.enabled });

  return board;
}
