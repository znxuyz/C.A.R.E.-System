/**
 * 下課管制（每日帳）
 *
 * `recessRestrictions/{studentId}_{YYYY-MM-DD}`：每生每日一筆。
 * 同日可有多個管制來源（待回收紙本、觀察員值勤、待回收檢討書），
 * 只有全部來源解除才真正解鎖。
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
} from 'firebase/firestore';
import { COL, restrictionId } from '../firestore/paths.js';
import type { RestrictionReason, SchoolDate } from '../domain/types.js';
import type { Ctx } from './context.js';

export interface RestrictionStudent {
  id: string;
  studentNo: string;
  name: string;
  classId: string;
  className: string;
  seatNo?: number | null;
}

export interface FreezeInput {
  student: RestrictionStudent;
  date: SchoolDate;
  reason: RestrictionReason;
  periods: number[];
  sourceRef: { infractionId?: string; assignmentId?: string };
  note?: string;
}

/**
 * 合併既有管制帳與新的管制來源（純函式，交易內外皆可用）。
 * 交易中不能使用 arrayUnion，必須自行計算合併後的值。
 */
export function mergeRestriction(
  existing: DocumentData | undefined,
  input: FreezeInput,
): DocumentData {
  const reasons = new Set<RestrictionReason>((existing?.reasons as RestrictionReason[]) ?? []);
  reasons.add(input.reason);
  const sourceRefs = [
    ...(((existing?.sourceRefs as Array<Record<string, unknown>>) ?? []).filter(
      (ref) => ref.reason !== input.reason,
    )),
    {
      reason: input.reason,
      infractionId: input.sourceRef.infractionId ?? null,
      assignmentId: input.sourceRef.assignmentId ?? null,
    },
  ];

  return {
    studentId: input.student.id,
    studentNo: input.student.studentNo,
    studentName: input.student.name,
    classId: input.student.classId,
    className: input.student.className,
    seatNo: input.student.seatNo ?? null,
    date: input.date,
    reasons: [...reasons],
    sourceRefs,
    status: 'ACTIVE',
    allowWaterAndRestroom: true,
    periods: input.periods,
    note: input.note ?? null,
    updatedAt: serverTimestamp(),
  };
}

/** 凍結（或追加）某生某日的自由下課權限 */
export async function freezeRecess(ctx: Ctx, input: FreezeInput): Promise<string> {
  const id = restrictionId(input.student.id, input.date);
  const ref = doc(ctx.db, COL.recessRestrictions, id);
  const snap = await getDoc(ref);
  await setDoc(ref, mergeRestriction(snap.data(), input), { merge: true });
  return id;
}

/**
 * 解除某個管制來源；所有來源都排除後才整筆 LIFTED。
 */
export async function liftRestriction(
  ctx: Ctx,
  params: { studentId: string; date: SchoolDate; reason: RestrictionReason; note?: string },
): Promise<'LIFTED' | 'PARTIAL' | 'NOT_FOUND'> {
  const ref = doc(ctx.db, COL.recessRestrictions, restrictionId(params.studentId, params.date));
  const snap = await getDoc(ref);
  if (!snap.exists()) return 'NOT_FOUND';

  const data = snap.data();
  const remaining = ((data.reasons as RestrictionReason[]) ?? []).filter(
    (reason) => reason !== params.reason,
  );

  if (remaining.length > 0) {
    await updateDoc(ref, {
      reasons: remaining,
      sourceRefs: ((data.sourceRefs as Array<Record<string, unknown>>) ?? []).filter(
        (item) => item.reason !== params.reason,
      ),
      updatedAt: serverTimestamp(),
    });
    return 'PARTIAL';
  }

  await updateDoc(ref, {
    reasons: [],
    status: 'LIFTED',
    liftedAt: serverTimestamp(),
    liftReason: params.note ?? '所有管制條件已完成',
    updatedAt: serverTimestamp(),
  });
  return 'LIFTED';
}

/** 解鎖日之後仍存在的管制一併解除 */
export async function liftFrom(
  ctx: Ctx,
  params: { studentId: string; fromDate: SchoolDate; reason: RestrictionReason; note: string },
): Promise<void> {
  const snap = await getDocs(
    query(
      collection(ctx.db, COL.recessRestrictions),
      where('studentId', '==', params.studentId),
      where('status', '==', 'ACTIVE'),
      where('date', '>=', params.fromDate),
    ),
  );
  for (const docSnap of snap.docs) {
    await liftRestriction(ctx, {
      studentId: params.studentId,
      date: docSnap.get('date') as SchoolDate,
      reason: params.reason,
      note: params.note,
    });
  }
}

export async function listRestrictionsOn(ctx: Ctx, date: SchoolDate) {
  const snap = await getDocs(
    query(
      collection(ctx.db, COL.recessRestrictions),
      where('date', '==', date),
      orderBy('className'),
    ),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
