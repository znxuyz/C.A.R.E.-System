/**
 * 違規登錄與紙本回收服務
 *
 * 流程（生教組長一人操作）：
 *   登錄違規（學號、類型、地點、節次）
 *     → 自動凍結該生當日自由下課、發放對應紙本反思卡
 *     → 自動回溯 15 天判定是否達再犯門檻
 *   紙本反思卡回收 → 標記回收 → 當日解除下課管制
 *   誤報可撤銷、班級活動優先可免記，皆不計入再犯
 */
import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, col } from '../data/collections.js';
import {
  findStudentByNo,
  getClass,
  getInfraction,
  getStudent,
  loadSettings,
  writeAuditLog,
  type StudentRecord,
} from '../data/repositories.js';
import {
  assertCanAnnotate,
  assertCanReturnPaper,
  unlockDateForPaperReturn,
} from '../domain/caseRules.js';
import { toSchoolDate } from '../domain/dates.js';
import {
  INFRACTION_STATUS,
  PAPER_CARD_LABEL,
  RESTRICTION_REASONS,
  type Infraction,
  type PaperCard,
} from '../domain/types.js';
import type { Clock } from '../lib/clock.js';
import { invalid, notFound } from '../lib/errors.js';
import { queueHomeroomEmail } from '../notifications/email.js';
import { evaluateAndTrigger, type EvaluateResult } from './recidivismService.js';
import { freezeRecess, liftRestriction } from './restrictionService.js';

export interface LogInfractionInput {
  /** 二者擇一：學號（現場最常用）或學生文件 ID */
  studentNo?: string;
  studentId?: string;
  typeCode: string;
  /** 違規時間（ISO）；未提供則以伺服器現在時間為準 */
  occurredAt?: string;
  periodNo?: number;
  locationCode: string;
  note?: string;
  actor: { uid: string; name: string };
}

export interface LogInfractionResult {
  infractionId: string;
  studentId: string;
  studentName: string;
  className: string;
  paperCard: PaperCard;
  paperCardLabel: string;
  restrictionId: string;
  recidivism: EvaluateResult;
}

interface InfractionTypeConfig {
  code: string;
  name: string;
  paperCard: PaperCard;
  countsTowardRecidivism?: boolean;
  active?: boolean;
}

export async function logInfraction(
  firestore: Firestore,
  input: LogInfractionInput,
  clock: Clock,
): Promise<LogInfractionResult> {
  if (!input.studentNo && !input.studentId) {
    throw invalid('請提供學號或學生 ID');
  }

  const student: StudentRecord = input.studentId
    ? await getStudent(firestore, input.studentId)
    : ((await findStudentByNo(firestore, input.studentNo!)) ??
      (() => {
        throw notFound(`學號 ${input.studentNo} 的學生`);
      })());

  const [typeSnap, locationSnap, settings] = await Promise.all([
    col(firestore, COLLECTIONS.infractionTypes).doc(input.typeCode).get(),
    col(firestore, COLLECTIONS.locations).doc(input.locationCode).get(),
    loadSettings(firestore),
  ]);

  if (!typeSnap.exists) throw notFound(`違規類型 ${input.typeCode}`);
  const type = { code: typeSnap.id, ...(typeSnap.data() as Omit<InfractionTypeConfig, 'code'>) };
  if (type.active === false) throw invalid(`違規類型 ${type.name} 已停用`);

  const now = clock.now();
  const occurredAt = input.occurredAt ?? now;
  const occurredOn = toSchoolDate(occurredAt, settings.timezone);
  const infractionRef = col(firestore, COLLECTIONS.infractions).doc();

  const infraction: Omit<Infraction, 'id'> = {
    studentId: student.id,
    studentNo: student.studentNo,
    studentName: student.name,
    classId: student.classId,
    className: student.className,
    seatNo: student.seatNo,
    typeCode: type.code,
    typeName: type.name,
    paperCard: type.paperCard,
    occurredAt,
    occurredOn,
    periodNo: input.periodNo ?? 0,
    locationCode: input.locationCode,
    locationName: (locationSnap.get('name') as string) ?? input.locationCode,
    note: input.note,
    recordedBy: input.actor,
    status: INFRACTION_STATUS.OPEN,
    countsTowardRecidivism: type.countsTowardRecidivism !== false,
    consumedByAlertId: null,
    createdAt: now,
    updatedAt: now,
  };
  await infractionRef.set(infraction);

  // ① 凍結當日自由下課，待紙本反思卡回收
  const restrictionDocId = await freezeRecess(
    firestore,
    {
      student,
      date: occurredOn,
      reason: RESTRICTION_REASONS.INFRACTION_PAPER,
      periods: [],
      sourceRef: { infractionId: infractionRef.id },
      note: `${type.name}｜待回收${PAPER_CARD_LABEL[type.paperCard]}`,
    },
    clock,
  );

  // ② 回溯 15 天判定再犯
  const recidivism = await evaluateAndTrigger(
    firestore,
    {
      studentId: student.id,
      asOf: occurredOn,
      triggerInfractionId: infractionRef.id,
      student,
      settings,
    },
    clock,
  );

  // ③ 選用：Email 通知導師（預設關閉，見 settings.emailHomeroom）
  if (settings.emailHomeroom) {
    const klass = await getClass(firestore, student.classId).catch(() => null);
    if (klass?.homeroomEmail) {
      await queueHomeroomEmail(firestore, {
        to: klass.homeroomEmail,
        student,
        typeName: type.name,
        paperCardLabel: PAPER_CARD_LABEL[type.paperCard],
        locationName: infraction.locationName,
        occurredAt,
        periodNo: infraction.periodNo,
        recidivismCount: recidivism.count,
        threshold: settings.recidivismThreshold,
        now,
      });
    }
  }

  await writeAuditLog(firestore, {
    actorUid: input.actor.uid,
    actorName: input.actor.name,
    action: 'INFRACTION_LOGGED',
    entityType: COLLECTIONS.infractions,
    entityId: infractionRef.id,
    after: infraction,
    at: now,
  });

  return {
    infractionId: infractionRef.id,
    studentId: student.id,
    studentName: student.name,
    className: student.className,
    paperCard: type.paperCard,
    paperCardLabel: PAPER_CARD_LABEL[type.paperCard],
    restrictionId: restrictionDocId,
    recidivism,
  };
}

/** 紙本反思卡回收 → 當日解除下課管制 */
export async function markPaperReturned(
  firestore: Firestore,
  params: { infractionId: string; actor: { uid: string; name: string } },
  clock: Clock,
): Promise<{ status: string; unlockOn: string }> {
  const infraction = await getInfraction(firestore, params.infractionId);
  assertCanReturnPaper(infraction.status);

  const now = clock.now();
  const returnedOn = clock.today();
  const unlockOn = unlockDateForPaperReturn(returnedOn);

  await col(firestore, COLLECTIONS.infractions).doc(infraction.id).update({
    status: INFRACTION_STATUS.DONE,
    paperReturnedAt: now,
    paperReturnedOn: returnedOn,
    updatedAt: now,
  });

  // 解除「違規當日」與「回收當日」兩筆管制帳
  // （當日回收時為同一筆；跨日回收時，先前每日續帳的管制也一併解除）
  for (const date of new Set([infraction.occurredOn, unlockOn])) {
    await liftRestriction(
      firestore,
      {
        studentId: infraction.studentId,
        date,
        reason: RESTRICTION_REASONS.INFRACTION_PAPER,
        note: '紙本反思卡已回收，解除下課管制',
      },
      clock,
    );
  }

  await writeAuditLog(firestore, {
    actorUid: params.actor.uid,
    actorName: params.actor.name,
    action: 'INFRACTION_PAPER_RETURNED',
    entityType: COLLECTIONS.infractions,
    entityId: infraction.id,
    before: { status: infraction.status },
    after: { status: INFRACTION_STATUS.DONE, returnedOn },
    at: now,
  });

  return { status: INFRACTION_STATUS.DONE, unlockOn };
}

/**
 * 免記（班級活動優先等事由）或撤銷（誤報）。
 * 兩者都會：不計入再犯、解除當日管制、寫入稽核。
 */
export async function annotateInfraction(
  firestore: Firestore,
  params: {
    infractionId: string;
    action: 'EXEMPT' | 'VOID';
    reason: string;
    actor: { uid: string; name: string };
  },
  clock: Clock,
): Promise<void> {
  const infraction = await getInfraction(firestore, params.infractionId);
  assertCanAnnotate(infraction.status, params.reason);

  const now = clock.now();
  const isExempt = params.action === 'EXEMPT';
  const status = isExempt ? INFRACTION_STATUS.EXEMPTED : INFRACTION_STATUS.VOIDED;

  await col(firestore, COLLECTIONS.infractions).doc(infraction.id).update({
    status,
    countsTowardRecidivism: false,
    ...(isExempt ? { exemptReason: params.reason } : { voidReason: params.reason }),
    updatedAt: now,
  });

  await liftRestriction(
    firestore,
    {
      studentId: infraction.studentId,
      date: infraction.occurredOn,
      reason: RESTRICTION_REASONS.INFRACTION_PAPER,
      note: `${isExempt ? '免記' : '撤銷'}：${params.reason}`,
    },
    clock,
  );

  await writeAuditLog(firestore, {
    actorUid: params.actor.uid,
    actorName: params.actor.name,
    action: isExempt ? 'INFRACTION_EXEMPTED' : 'INFRACTION_VOIDED',
    entityType: COLLECTIONS.infractions,
    entityId: infraction.id,
    before: { status: infraction.status },
    after: { status, reason: params.reason },
    at: now,
  });
}

/** 待回收紙本反思卡的案件清單 */
export async function listPendingPapers(
  firestore: Firestore,
  limit = 100,
): Promise<Infraction[]> {
  const snap = await col(firestore, COLLECTIONS.infractions)
    .where('status', '==', INFRACTION_STATUS.OPEN)
    .orderBy('occurredOn', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<Infraction, 'id'>) }));
}
