/**
 * 下課管制（每日帳）服務
 *
 * 資料模型：`recessRestrictions/{studentId}_{YYYY-MM-DD}`（每生每日一筆）
 *  - 學務處最常問「今天有哪些人要管制？」→ 單欄位查詢 `date == today`。
 *  - 自然鍵天然去重：同日多次違規只會累加 reasons，不會重複扣權益。
 *  - 正向管教：`allowWaterAndRestroom` 永遠為 true，UI 固定顯示「可正常飲水與如廁」。
 */
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, col, restrictionId } from '../data/collections.js';
import type { Clock } from '../lib/clock.js';
import type { RecessRestriction, RestrictionReason, SchoolDate } from '../domain/types.js';
import type { StudentRecord } from '../data/repositories.js';

export interface FreezeInput {
  student: StudentRecord;
  date: SchoolDate;
  reason: RestrictionReason;
  periods: number[];
  sourceRef: { infractionId?: string; assignmentId?: string };
  note?: string;
}

/** 凍結（或追加）某生某日的自由下課權限 */
export async function freezeRecess(
  firestore: Firestore,
  input: FreezeInput,
  clock: Clock,
): Promise<string> {
  const id = restrictionId(input.student.id, input.date);
  const ref = col(firestore, COLLECTIONS.recessRestrictions).doc(id);
  const now = clock.now();

  await ref.set(
    {
      studentId: input.student.id,
      studentNo: input.student.studentNo,
      studentName: input.student.name,
      classId: input.student.classId,
      className: input.student.className,
      seatNo: input.student.seatNo ?? null,
      date: input.date,
      reasons: FieldValue.arrayUnion(input.reason),
      sourceRefs: FieldValue.arrayUnion({
        reason: input.reason,
        infractionId: input.sourceRef.infractionId ?? null,
        assignmentId: input.sourceRef.assignmentId ?? null,
      }),
      status: 'ACTIVE',
      allowWaterAndRestroom: true,
      periods: input.periods,
      note: input.note ?? null,
      createdAt: now,
      updatedAt: now,
    },
    { merge: true },
  );
  return id;
}

/**
 * 解除管制。
 * 僅當該日所有管制來源都已排除時才真正解鎖：
 * 例如同日既有未回收的反思卡、又是安全觀察員值勤日，
 * 回收反思卡只會移除 INFRACTION_PAPER 這個來源。
 */
export async function liftRestriction(
  firestore: Firestore,
  params: { studentId: string; date: SchoolDate; reason: RestrictionReason; note?: string },
  clock: Clock,
): Promise<'LIFTED' | 'PARTIAL' | 'NOT_FOUND'> {
  const ref = col(firestore, COLLECTIONS.recessRestrictions).doc(
    restrictionId(params.studentId, params.date),
  );
  const now = clock.now();

  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return 'NOT_FOUND';

    const data = snap.data() as RecessRestriction;
    const remaining = (data.reasons ?? []).filter((reason) => reason !== params.reason);

    if (remaining.length > 0) {
      tx.update(ref, {
        reasons: remaining,
        sourceRefs: (data.sourceRefs ?? []).filter((s) => s.reason !== params.reason),
        updatedAt: now,
      });
      return 'PARTIAL';
    }

    tx.update(ref, {
      reasons: [],
      status: 'LIFTED',
      liftedAt: now,
      liftReason: params.note ?? '所有管制條件已完成',
      updatedAt: now,
    });
    return 'LIFTED';
  });
}

/** 今日（或指定日）管制名單 */
export async function listRestrictionsOn(
  firestore: Firestore,
  date: SchoolDate,
): Promise<RecessRestriction[]> {
  const snap = await col(firestore, COLLECTIONS.recessRestrictions)
    .where('date', '==', date)
    .orderBy('className')
    .get();
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<RecessRestriction, 'id'>) }));
}

/** 解鎖日之後仍存在的管制帳一併解除（安全觀察員結案用） */
export async function liftFrom(
  firestore: Firestore,
  params: { studentId: string; fromDate: SchoolDate; reason: RestrictionReason; note: string },
  clock: Clock,
): Promise<void> {
  const snap = await col(firestore, COLLECTIONS.recessRestrictions)
    .where('studentId', '==', params.studentId)
    .where('status', '==', 'ACTIVE')
    .where('date', '>=', params.fromDate)
    .get();
  for (const doc of snap.docs) {
    await liftRestriction(
      firestore,
      {
        studentId: params.studentId,
        date: doc.get('date') as SchoolDate,
        reason: params.reason,
        note: params.note,
      },
      clock,
    );
  }
}
