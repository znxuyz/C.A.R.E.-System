/**
 * Firestore 讀寫層
 *
 * 約定：
 *  - 所有時間戳以 ISO-8601 字串儲存（伺服器產生），故文件結構 === 領域型別，
 *    無需額外 converter；日期欄位（countOn / date / dutyOn）為 `YYYY-MM-DD`。
 *  - 需要在交易中讀取的查詢一律回傳「文件快照 + 資料」，方便後續 tx.update。
 */
import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { createSchoolCalendar, type SchoolCalendar } from '../domain/dates.js';
import {
  DEFAULT_SETTINGS,
  type Infraction,
  type ReflectionCard,
  type SchoolDate,
  type SystemSettings,
} from '../domain/types.js';
import { COLLECTIONS, SETTINGS_DOC_ID, col, restrictionId } from './collections.js';
import { COUNTABLE_CASE_STATUSES, type CountableCard } from '../domain/recidivism.js';
import { notFound } from '../lib/errors.js';

/* ------------------------------ 系統設定 ------------------------------ */

export async function loadSettings(firestore: Firestore): Promise<SystemSettings> {
  const snap = await col(firestore, COLLECTIONS.settings).doc(SETTINGS_DOC_ID).get();
  if (!snap.exists) return DEFAULT_SETTINGS;
  return { ...DEFAULT_SETTINGS, ...(snap.data() as Partial<SystemSettings>) };
}

/* ------------------------------- 校曆 -------------------------------- */

/**
 * 載入校曆例外日（僅需載入未來/近期區間即可；預設週一~週五為上課日）。
 * schoolCalendar/{YYYY-MM-DD} → { isSchoolDay: boolean, note?: string }
 */
export async function loadCalendar(
  firestore: Firestore,
  from: SchoolDate,
  to: SchoolDate,
): Promise<SchoolCalendar> {
  const snap = await col(firestore, COLLECTIONS.schoolCalendar)
    .where('date', '>=', from)
    .where('date', '<=', to)
    .get();
  const overrides: Record<SchoolDate, boolean> = {};
  for (const doc of snap.docs) {
    const data = doc.data() as { date?: SchoolDate; isSchoolDay?: boolean };
    if (data.date && typeof data.isSchoolDay === 'boolean') {
      overrides[data.date] = data.isSchoolDay;
    }
  }
  return createSchoolCalendar(overrides);
}

/* ------------------------------ 學生 / 班級 ---------------------------- */

export interface StudentRecord {
  id: string;
  studentNo: string;
  name: string;
  classId: string;
  className: string;
  guardianEmail?: string;
  uid?: string;
}

export async function getStudent(firestore: Firestore, studentId: string): Promise<StudentRecord> {
  const snap = await col(firestore, COLLECTIONS.students).doc(studentId).get();
  if (!snap.exists) throw notFound(`學生 ${studentId}`);
  return { id: snap.id, ...(snap.data() as Omit<StudentRecord, 'id'>) };
}

/** 以學號查學生（登錄違規時常以學號輸入） */
export async function findStudentByNo(
  firestore: Firestore,
  studentNo: string,
): Promise<StudentRecord | null> {
  const snap = await col(firestore, COLLECTIONS.students)
    .where('studentNo', '==', studentNo)
    .limit(1)
    .get();
  const doc = snap.docs[0];
  return doc ? { id: doc.id, ...(doc.data() as Omit<StudentRecord, 'id'>) } : null;
}

export interface ClassRecord {
  id: string;
  name: string;
  homeroomTeacherUid?: string;
  homeroomTeacherName?: string;
}

export async function getClass(firestore: Firestore, classId: string): Promise<ClassRecord> {
  const snap = await col(firestore, COLLECTIONS.classes).doc(classId).get();
  if (!snap.exists) throw notFound(`班級 ${classId}`);
  return { id: snap.id, ...(snap.data() as Omit<ClassRecord, 'id'>) };
}

/* ------------------------------ 違規事件 ------------------------------ */

export async function getInfraction(
  firestore: Firestore,
  infractionId: string,
): Promise<Infraction> {
  const snap = await col(firestore, COLLECTIONS.infractions).doc(infractionId).get();
  if (!snap.exists) throw notFound(`違規事件 ${infractionId}`);
  return { id: snap.id, ...(snap.data() as Omit<Infraction, 'id'>) };
}

/* ------------------------------- 反思卡 ------------------------------- */

export async function getReflectionCard(
  firestore: Firestore,
  cardId: string,
): Promise<ReflectionCard> {
  const snap = await col(firestore, COLLECTIONS.reflectionCards).doc(cardId).get();
  if (!snap.exists) throw notFound(`反思卡 ${cardId}`);
  return { id: snap.id, ...(snap.data() as Omit<ReflectionCard, 'id'>) };
}

/**
 * 累犯視窗查詢（核心）
 *
 * 等價 SQL：
 *   SELECT id, student_id, count_on, form_kind, status,
 *          counts_toward_recidivism, consumed_by_alert_id
 *     FROM reflection_cards
 *    WHERE student_id = :studentId
 *      AND count_on BETWEEN :windowStart AND :windowEnd
 *      AND counts_toward_recidivism = TRUE
 *      AND consumed_by_alert_id IS NULL
 *      AND status IN ('PENDING_TEACHER','PENDING_OFFICE','COMPLETED');
 *
 * 需要之複合索引（見 firestore.indexes.json）：
 *   reflectionCards: studentId ASC, countsTowardRecidivism ASC,
 *                    consumedByAlertId ASC, status ASC, countOn ASC
 *
 * 必須在 Transaction 內讀取，才能與「認列卡片 / 建立警示」形成原子操作，
 * 避免兩張卡同時送出造成重複觸發（race condition）。
 */
export async function readRecidivismWindowCards(
  firestore: Firestore,
  tx: Transaction,
  params: { studentId: string; windowStart: SchoolDate; windowEnd: SchoolDate; limit?: number },
): Promise<Array<{ ref: FirebaseFirestore.DocumentReference; card: CountableCard }>> {
  const query = col(firestore, COLLECTIONS.reflectionCards)
    .where('studentId', '==', params.studentId)
    .where('countsTowardRecidivism', '==', true)
    .where('consumedByAlertId', '==', null)
    .where('status', 'in', [...COUNTABLE_CASE_STATUSES])
    .where('countOn', '>=', params.windowStart)
    .where('countOn', '<=', params.windowEnd)
    .orderBy('countOn', 'asc')
    .limit(params.limit ?? 50);

  const snap = await tx.get(query);
  return snap.docs.map((doc) => ({
    ref: doc.ref,
    card: {
      id: doc.id,
      studentId: doc.get('studentId') as string,
      countOn: doc.get('countOn') as SchoolDate,
      formKind: doc.get('formKind'),
      status: doc.get('status'),
      countsTowardRecidivism: doc.get('countsTowardRecidivism') as boolean,
      consumedByAlertId: (doc.get('consumedByAlertId') as string | null) ?? null,
    },
  }));
}

/** 生教組待蓋章佇列 */
export async function listPendingOfficeCards(
  firestore: Firestore,
  limit = 50,
): Promise<ReflectionCard[]> {
  const snap = await col(firestore, COLLECTIONS.reflectionCards)
    .where('status', '==', 'PENDING_OFFICE')
    .orderBy('teacherSignedAt', 'asc')
    .limit(limit)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ReflectionCard, 'id'>) }));
}

/* ---------------------------- 下課管制每日帳 --------------------------- */

export function restrictionRef(firestore: Firestore, studentId: string, date: SchoolDate) {
  return col(firestore, COLLECTIONS.recessRestrictions).doc(restrictionId(studentId, date));
}

/* -------------------------------- 稽核 -------------------------------- */

export async function writeAuditLog(
  firestore: Firestore,
  entry: {
    actorUid: string;
    actorName?: string;
    action: string;
    entityType: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
    at: string;
  },
): Promise<void> {
  await col(firestore, COLLECTIONS.auditLogs).add({
    ...entry,
    createdAt: entry.at,
    serverReceivedAt: FieldValue.serverTimestamp(),
  });
}
