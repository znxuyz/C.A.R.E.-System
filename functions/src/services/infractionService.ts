/**
 * 違規事件登錄與通報服務
 *
 * 規格：
 *  - 生教組、糾察隊或巡堂教師登錄違規（學號/姓名、違規類型、地點、時間）。
 *  - 登錄成功後：① 自動凍結該生「當日」自由下課權限
 *                ② 發送 App 推播 / Email 通知該班導師
 *  - 同時依違規類型自動建立對應反思卡（走廊奔跑 → 校園安全反思卡；
 *    口出穢言 → 口說好話反思卡），學生登入即可填寫。
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
import { toSchoolDate } from '../domain/dates.js';
import {
  CASE_STATUS,
  INFRACTION_STATUS,
  RESTRICTION_REASONS,
  type FormKind,
  type Infraction,
  type ReflectionCard,
  type Role,
} from '../domain/types.js';
import type { Clock } from '../lib/clock.js';
import { invalid, notFound } from '../lib/errors.js';
import { notify, resolveRecipients } from '../notifications/notifier.js';
import { freezeRecess, liftRestriction } from './restrictionService.js';
import { evaluateAndTrigger } from './recidivismService.js';

export interface LogInfractionInput {
  /** 二者擇一：學號（現場最常用）或學生文件 ID */
  studentNo?: string;
  studentId?: string;
  typeCode: string;
  /** 違規時間（ISO）；未提供則以伺服器現在時間為準 */
  occurredAt?: string;
  periodNo?: number;
  locationCode: string;
  locationDetail?: string;
  description?: string;
  reporter: { uid: string; name: string; role: Role };
}

export interface LogInfractionResult {
  infractionId: string;
  reflectionCardId: string;
  restrictionId: string;
  formKind: FormKind;
  notifiedTeacher: boolean;
}

interface InfractionTypeConfig {
  code: string;
  name: string;
  formTemplateId: string;
  formKind: FormKind;
  countsTowardRecidivism: boolean;
  active: boolean;
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

  const [typeSnap, locationSnap, klass, settings] = await Promise.all([
    col(firestore, COLLECTIONS.infractionTypes).doc(input.typeCode).get(),
    col(firestore, COLLECTIONS.locations).doc(input.locationCode).get(),
    getClass(firestore, student.classId),
    loadSettings(firestore),
  ]);

  if (!typeSnap.exists) throw notFound(`違規類型 ${input.typeCode}`);
  const type = { code: typeSnap.id, ...(typeSnap.data() as Omit<InfractionTypeConfig, 'code'>) };
  if (type.active === false) throw invalid(`違規類型 ${type.name} 已停用`);

  const templateSnap = await col(firestore, COLLECTIONS.formTemplates)
    .doc(type.formTemplateId)
    .get();
  if (!templateSnap.exists) throw notFound(`表單模板 ${type.formTemplateId}`);

  const now = clock.now();
  const occurredAt = input.occurredAt ?? now;
  const occurredOn = toSchoolDate(occurredAt, settings.timezone);

  const infractionRef = col(firestore, COLLECTIONS.infractions).doc();
  const cardRef = col(firestore, COLLECTIONS.reflectionCards).doc();

  const infraction: Omit<Infraction, 'id'> = {
    studentId: student.id,
    studentNo: student.studentNo,
    studentName: student.name,
    classId: student.classId,
    className: student.className,
    typeCode: type.code,
    typeName: type.name,
    formKind: type.formKind,
    occurredAt,
    occurredOn,
    periodNo: input.periodNo ?? 0,
    locationCode: input.locationCode,
    locationName: (locationSnap.get('name') as string) ?? input.locationCode,
    locationDetail: input.locationDetail,
    description: input.description,
    reporter: input.reporter,
    status: INFRACTION_STATUS.OPEN,
    reflectionCardId: cardRef.id,
    createdAt: now,
    updatedAt: now,
  };

  const card: Omit<ReflectionCard, 'id'> = {
    infractionId: infractionRef.id,
    studentId: student.id,
    studentNo: student.studentNo,
    studentName: student.name,
    classId: student.classId,
    templateId: templateSnap.id,
    templateVersion: (templateSnap.get('version') as number) ?? 1,
    formKind: type.formKind,
    status: CASE_STATUS.DRAFT,
    // 累犯基準日 = 違規發生日（非填寫日），避免補填造成視窗漂移
    countOn: occurredOn,
    countsTowardRecidivism: type.countsTowardRecidivism !== false,
    consumedByAlertId: null,
    answers: {},
    approvals: [],
    returnCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  // 違規事件與反思卡一次寫入，避免出現「有事件卻無卡可填」的中間態
  const batch = firestore.batch();
  batch.set(infractionRef, infraction);
  batch.set(cardRef, card);
  await batch.commit();

  // ① 凍結當日自由下課
  const restrictionDocId = await freezeRecess(
    firestore,
    {
      student,
      date: occurredOn,
      reason: RESTRICTION_REASONS.INFRACTION_REFLECTION,
      periods: [],
      sourceRef: { infractionId: infractionRef.id },
      note: `${type.name}｜待完成${templateSnap.get('title') ?? '反思卡'}`,
    },
    clock,
  );

  // ② 通知班導師（App 推播 + Email）
  const recipients = await resolveRecipients(firestore, 'HOMEROOM_TEACHER', {
    classId: student.classId,
  });
  if (recipients.length > 0) {
    await notify(firestore, {
      templateCode: 'INFRACTION_LOGGED',
      audience: 'HOMEROOM_TEACHER',
      recipients,
      context: {
        studentName: student.name,
        studentNo: student.studentNo,
        className: student.className,
        typeName: type.name,
        locationName: infraction.locationName,
        occurredAt: occurredAt,
        periodNo: infraction.periodNo,
        cardTitle: templateSnap.get('title') as string,
      },
      relatedRef: { kind: 'infractions', id: infractionRef.id },
      now,
      channels: settings.notifications,
    });
  }

  await writeAuditLog(firestore, {
    actorUid: input.reporter.uid,
    actorName: input.reporter.name,
    action: 'INFRACTION_LOGGED',
    entityType: 'infractions',
    entityId: infractionRef.id,
    after: { ...infraction, reflectionCardId: cardRef.id },
    at: now,
  });

  return {
    infractionId: infractionRef.id,
    reflectionCardId: cardRef.id,
    restrictionId: restrictionDocId,
    formKind: type.formKind,
    notifiedTeacher: recipients.length > 0,
  };
}

/**
 * 撤銷違規（誤報）。
 * 生教組專屬；連動作廢反思卡、解除當日管制，並重新評估累犯進度
 * （若該卡已被警示認列，警示由生教組另行以 dismissAlert 處理）。
 */
export async function voidInfraction(
  firestore: Firestore,
  params: { infractionId: string; reason: string; actor: { uid: string; name: string } },
  clock: Clock,
): Promise<void> {
  const infraction = await getInfraction(firestore, params.infractionId);
  const now = clock.now();

  const batch = firestore.batch();
  batch.update(col(firestore, COLLECTIONS.infractions).doc(infraction.id), {
    status: INFRACTION_STATUS.VOIDED,
    voidReason: params.reason,
    updatedAt: now,
  });
  if (infraction.reflectionCardId) {
    batch.update(col(firestore, COLLECTIONS.reflectionCards).doc(infraction.reflectionCardId), {
      status: CASE_STATUS.VOIDED,
      countsTowardRecidivism: false,
      updatedAt: now,
    });
  }
  await batch.commit();

  await liftRestriction(
    firestore,
    {
      studentId: infraction.studentId,
      date: infraction.occurredOn,
      reason: RESTRICTION_REASONS.INFRACTION_REFLECTION,
      note: `違規撤銷：${params.reason}`,
    },
    clock,
  );

  await writeAuditLog(firestore, {
    actorUid: params.actor.uid,
    actorName: params.actor.name,
    action: 'INFRACTION_VOIDED',
    entityType: 'infractions',
    entityId: infraction.id,
    before: { status: infraction.status },
    after: { status: INFRACTION_STATUS.VOIDED, reason: params.reason },
    at: now,
  });
}

/** 重新評估某生累犯（豁免/撤銷後呼叫），不觸發時僅回報進度 */
export async function reevaluate(
  firestore: Firestore,
  params: { studentId: string; asOf: string; triggerCardId: string },
  clock: Clock,
) {
  return evaluateAndTrigger(firestore, { ...params, triggerCardId: params.triggerCardId }, clock);
}
