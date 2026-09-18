/**
 * 案件服務：反思卡 / 行為檢討書的填寫與雙重審核
 *
 * 職責分工：
 *  - `domain/workflow.ts` 決定「狀態怎麼轉、會產生哪些副作用」（純函式、可測）。
 *  - 本檔負責把副作用（effects）落實到 Firestore：解除管制、豁免違規、
 *    觸發累犯偵測、安排隔日解鎖、發送通知。
 */
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, col } from '../data/collections.js';
import {
  getStudent,
  loadCalendar,
  loadSettings,
  writeAuditLog,
  type StudentRecord,
} from '../data/repositories.js';
import { addDays } from '../domain/dates.js';
import {
  APPROVAL_STAGES,
  ASSIGNMENT_STATUS,
  CASE_STATUS,
  INFRACTION_STATUS,
  RESTRICTION_REASONS,
  type ApprovalDecision,
  type ApprovalStage,
  type ConductReview,
  type ReflectionCard,
  type Role,
  type SystemSettings,
} from '../domain/types.js';
import {
  reviewCase,
  submitCase,
  type CaseKind,
  type CaseSnapshot,
  type WorkflowEffect,
} from '../domain/workflow.js';
import type { Clock } from '../lib/clock.js';
import { invalid, notFound, precondition } from '../lib/errors.js';
import { signatureHash } from '../lib/signature.js';
import { notify, resolveRecipients } from '../notifications/notifier.js';
import { evaluateAndTrigger } from './recidivismService.js';
import { liftRestriction } from './restrictionService.js';

export interface Actor {
  uid: string;
  name: string;
  roles: Role[];
}

interface EffectContext {
  kind: CaseKind;
  documentId: string;
  student: StudentRecord;
  settings: SystemSettings;
  cardTitle: string;
  infractionId?: string;
  assignmentId?: string;
  /** 觸發累犯評估用 */
  triggerCardId?: string;
  comment?: string;
  now: string;
}

/* ------------------------------------------------------------------ *
 * 反思卡
 * ------------------------------------------------------------------ */

/** 學生填寫並送出反思卡 */
export async function submitReflectionCard(
  firestore: Firestore,
  params: { cardId: string; answers: Record<string, unknown>; actor: Actor },
  clock: Clock,
): Promise<{ status: string }> {
  const ref = col(firestore, COLLECTIONS.reflectionCards).doc(params.cardId);
  const snap = await ref.get();
  if (!snap.exists) throw notFound(`反思卡 ${params.cardId}`);
  const card = { id: snap.id, ...(snap.data() as Omit<ReflectionCard, 'id'>) };

  const [settings, student] = await Promise.all([
    loadSettings(firestore),
    getStudent(firestore, card.studentId),
  ]);
  if (student.uid && student.uid !== params.actor.uid && !params.actor.roles.includes('ADMIN')) {
    throw precondition('僅該生本人可送出自己的反思卡');
  }
  await assertAnswersComplete(firestore, card.templateId, params.answers);

  const now = clock.now();
  const snapshot: CaseSnapshot = {
    kind: 'REFLECTION_CARD',
    status: card.status,
    approvals: card.approvals ?? [],
    returnCount: card.returnCount ?? 0,
    baseDate: card.countOn,
  };
  const result = submitCase(snapshot, params.actor, now);

  await ref.update({
    status: result.status,
    answers: params.answers,
    submittedAt: now,
    updatedAt: now,
  });

  await applyEffects(firestore, result.effects, {
    kind: 'REFLECTION_CARD',
    documentId: card.id,
    student,
    settings,
    cardTitle: await templateTitle(firestore, card.templateId),
    infractionId: card.infractionId,
    triggerCardId: card.id,
    now,
  }, clock);

  await writeAuditLog(firestore, {
    actorUid: params.actor.uid,
    actorName: params.actor.name,
    action: 'REFLECTION_CARD_SUBMITTED',
    entityType: COLLECTIONS.reflectionCards,
    entityId: card.id,
    before: { status: card.status },
    after: { status: result.status },
    at: now,
  });

  return { status: result.status };
}

export interface ReviewParams {
  stage: ApprovalStage;
  decision: ApprovalDecision;
  comment?: string;
  /** 導師端「班級活動優先」勾選鈕 */
  teacherActivityPriority?: boolean;
  exemptReason?: string;
  actor: Actor;
}

/** 導師簽章 / 生教組蓋章（反思卡） */
export async function reviewReflectionCard(
  firestore: Firestore,
  params: ReviewParams & { cardId: string },
  clock: Clock,
): Promise<{ status: string; signatureHash: string }> {
  const ref = col(firestore, COLLECTIONS.reflectionCards).doc(params.cardId);
  const snap = await ref.get();
  if (!snap.exists) throw notFound(`反思卡 ${params.cardId}`);
  const card = { id: snap.id, ...(snap.data() as Omit<ReflectionCard, 'id'>) };

  const [settings, student] = await Promise.all([
    loadSettings(firestore),
    getStudent(firestore, card.studentId),
  ]);
  await assertTeacherOwnsClass(firestore, params, student.classId);

  const now = clock.now();
  const today = clock.today();
  const hash = signatureHash({
    documentId: card.id,
    stage: params.stage,
    actorUid: params.actor.uid,
    decision: params.teacherActivityPriority ? 'EXEMPTED' : params.decision,
    actedAt: now,
  });

  const result = reviewCase(
    {
      kind: 'REFLECTION_CARD',
      status: card.status,
      approvals: card.approvals ?? [],
      returnCount: card.returnCount ?? 0,
      baseDate: card.countOn,
    },
    { ...params, signatureHash: hash, today },
    now,
  );

  const patch: Record<string, unknown> = {
    status: result.status,
    approvals: result.approvals,
    returnCount: result.returnCount,
    updatedAt: now,
  };
  if (result.teacherSignedAt) patch.teacherSignedAt = result.teacherSignedAt;
  if (result.officeStampedAt) patch.officeStampedAt = result.officeStampedAt;
  if (result.completedAt) patch.completedAt = result.completedAt;
  if (typeof result.countsTowardRecidivism === 'boolean') {
    patch.countsTowardRecidivism = result.countsTowardRecidivism;
  }
  await ref.update(patch);

  // 違規事件狀態同步
  if (card.infractionId) {
    const infractionPatch: Record<string, unknown> = { updatedAt: now };
    if (result.status === CASE_STATUS.COMPLETED) infractionPatch.status = INFRACTION_STATUS.RESOLVED;
    if (result.status === CASE_STATUS.EXEMPTED) infractionPatch.status = INFRACTION_STATUS.EXEMPTED;
    if (Object.keys(infractionPatch).length > 1) {
      await col(firestore, COLLECTIONS.infractions).doc(card.infractionId).update(infractionPatch);
    }
  }

  await applyEffects(firestore, result.effects, {
    kind: 'REFLECTION_CARD',
    documentId: card.id,
    student,
    settings,
    cardTitle: await templateTitle(firestore, card.templateId),
    infractionId: card.infractionId,
    triggerCardId: card.id,
    comment: params.comment,
    now,
  }, clock);

  await writeAuditLog(firestore, {
    actorUid: params.actor.uid,
    actorName: params.actor.name,
    action: `REFLECTION_CARD_${params.stage}_${params.teacherActivityPriority ? 'EXEMPTED' : params.decision}`,
    entityType: COLLECTIONS.reflectionCards,
    entityId: card.id,
    before: { status: card.status },
    after: { status: result.status, signatureHash: hash },
    at: now,
  });

  return { status: result.status, signatureHash: hash };
}

/* ------------------------------------------------------------------ *
 * 行為檢討書
 * ------------------------------------------------------------------ */

/** 安全觀察員值勤後提交行為檢討書 */
export async function submitConductReview(
  firestore: Firestore,
  params: { reviewId: string; answers: Record<string, unknown>; actor: Actor },
  clock: Clock,
): Promise<{ status: string }> {
  const ref = col(firestore, COLLECTIONS.conductReviews).doc(params.reviewId);
  const snap = await ref.get();
  if (!snap.exists) throw notFound(`行為檢討書 ${params.reviewId}`);
  const review = { id: snap.id, ...(snap.data() as Omit<ConductReview, 'id'>) };

  const [settings, student] = await Promise.all([
    loadSettings(firestore),
    getStudent(firestore, review.studentId),
  ]);
  await assertAnswersComplete(firestore, review.templateId, params.answers);

  const assignmentSnap = await col(firestore, COLLECTIONS.observerAssignments)
    .doc(review.assignmentId)
    .get();
  if (assignmentSnap.get('status') === ASSIGNMENT_STATUS.SCHEDULED) {
    throw precondition('尚未完成安全觀察員值勤，無法提交行為檢討書');
  }

  const now = clock.now();
  const result = submitCase(
    {
      kind: 'CONDUCT_REVIEW',
      status: review.status,
      approvals: review.approvals ?? [],
      returnCount: review.returnCount ?? 0,
      baseDate: assignmentSnap.get('dutyOn') as string,
    },
    params.actor,
    now,
  );

  await ref.update({
    status: result.status,
    answers: params.answers,
    submittedAt: now,
    updatedAt: now,
  });
  await assignmentSnap.ref.update({ status: ASSIGNMENT_STATUS.REVIEW_PENDING, updatedAt: now });

  await applyEffects(firestore, result.effects, {
    kind: 'CONDUCT_REVIEW',
    documentId: review.id,
    student,
    settings,
    cardTitle: '行為檢討書',
    assignmentId: review.assignmentId,
    now,
  }, clock);

  return { status: result.status };
}

/** 檢討書之導師簽章 / 生教組蓋章；通過後隔日解鎖 */
export async function reviewConductReview(
  firestore: Firestore,
  params: ReviewParams & { reviewId: string },
  clock: Clock,
): Promise<{ status: string; unlockOn?: string }> {
  const ref = col(firestore, COLLECTIONS.conductReviews).doc(params.reviewId);
  const snap = await ref.get();
  if (!snap.exists) throw notFound(`行為檢討書 ${params.reviewId}`);
  const review = { id: snap.id, ...(snap.data() as Omit<ConductReview, 'id'>) };

  const [settings, student] = await Promise.all([
    loadSettings(firestore),
    getStudent(firestore, review.studentId),
  ]);
  await assertTeacherOwnsClass(firestore, params, student.classId);

  const now = clock.now();
  const today = clock.today();
  // 隔日解鎖需依校曆順延（連假、補課）
  const calendar = await loadCalendar(firestore, today, addDays(today, 45));
  const hash = signatureHash({
    documentId: review.id,
    stage: params.stage,
    actorUid: params.actor.uid,
    decision: params.decision,
    actedAt: now,
  });

  const result = reviewCase(
    {
      kind: 'CONDUCT_REVIEW',
      status: review.status,
      approvals: review.approvals ?? [],
      returnCount: review.returnCount ?? 0,
      baseDate: review.completedOn ?? today,
    },
    { ...params, signatureHash: hash, calendar, today },
    now,
  );

  const patch: Record<string, unknown> = {
    status: result.status,
    approvals: result.approvals,
    returnCount: result.returnCount,
    updatedAt: now,
  };
  if (result.teacherSignedAt) patch.teacherSignedAt = result.teacherSignedAt;
  if (result.officeStampedAt) patch.officeStampedAt = result.officeStampedAt;
  if (result.completedAt) {
    patch.completedAt = result.completedAt;
    patch.completedOn = today;
  }
  if (result.unlockOn) patch.unlockOn = result.unlockOn;
  await ref.update(patch);

  await applyEffects(firestore, result.effects, {
    kind: 'CONDUCT_REVIEW',
    documentId: review.id,
    student,
    settings,
    cardTitle: '行為檢討書',
    assignmentId: review.assignmentId,
    comment: params.comment,
    now,
  }, clock);

  await writeAuditLog(firestore, {
    actorUid: params.actor.uid,
    actorName: params.actor.name,
    action: `CONDUCT_REVIEW_${params.stage}_${params.decision}`,
    entityType: COLLECTIONS.conductReviews,
    entityId: review.id,
    before: { status: review.status },
    after: { status: result.status, unlockOn: result.unlockOn, signatureHash: hash },
    at: now,
  });

  return { status: result.status, unlockOn: result.unlockOn };
}

/* ------------------------------------------------------------------ *
 * 副作用執行器
 * ------------------------------------------------------------------ */

async function applyEffects(
  firestore: Firestore,
  effects: WorkflowEffect[],
  ctx: EffectContext,
  clock: Clock,
): Promise<void> {
  for (const effect of effects) {
    switch (effect.type) {
      case 'LIFT_RESTRICTION': {
        await liftRestriction(
          firestore,
          {
            studentId: ctx.student.id,
            date: effect.date,
            reason: effect.reason,
            note: effect.note,
          },
          clock,
        );
        break;
      }

      case 'EXEMPT_INFRACTION': {
        if (!ctx.infractionId) break;
        await col(firestore, COLLECTIONS.infractions).doc(ctx.infractionId).update({
          status: INFRACTION_STATUS.EXEMPTED,
          exemption: {
            applied: true,
            reason: effect.reason,
            byUid: 'workflow',
            byName: '導師簽章（班級活動優先）',
            at: ctx.now,
          },
          updatedAt: ctx.now,
        });
        break;
      }

      case 'EVALUATE_RECIDIVISM': {
        if (!ctx.triggerCardId) break;
        await evaluateAndTrigger(
          firestore,
          {
            studentId: ctx.student.id,
            asOf: effect.asOf,
            triggerCardId: ctx.triggerCardId,
            student: ctx.student,
            settings: ctx.settings,
          },
          clock,
        );
        break;
      }

      case 'SCHEDULE_UNLOCK': {
        if (!ctx.assignmentId) break;
        await col(firestore, COLLECTIONS.observerAssignments).doc(ctx.assignmentId).update({
          unlockOn: effect.date,
          updatedAt: ctx.now,
        });
        // 解鎖日當天起不再管制：清除該日之後尚存的「待檢討書」管制帳
        await liftPendingReviewRestrictions(firestore, ctx.student.id, effect.date, clock);
        break;
      }

      case 'CLOSE_ASSIGNMENT': {
        if (!ctx.assignmentId) break;
        const assignmentRef = col(firestore, COLLECTIONS.observerAssignments).doc(ctx.assignmentId);
        const assignmentSnap = await assignmentRef.get();
        await assignmentRef.update({ status: ASSIGNMENT_STATUS.CLOSED, updatedAt: ctx.now });
        const alertId = assignmentSnap.get('alertId') as string | undefined;
        if (alertId) {
          await col(firestore, COLLECTIONS.recidivismAlerts).doc(alertId).update({
            status: 'CLOSED',
            closedAt: ctx.now,
            updatedAt: ctx.now,
          });
        }
        break;
      }

      case 'NOTIFY': {
        const recipients = await resolveRecipients(firestore, effect.audience, {
          classId: ctx.student.classId,
          studentId: ctx.student.id,
        });
        if (recipients.length === 0) break;
        await notify(firestore, {
          templateCode: effect.templateCode,
          audience: effect.audience,
          recipients,
          context: {
            studentName: ctx.student.name,
            studentNo: ctx.student.studentNo,
            className: ctx.student.className,
            cardTitle: ctx.cardTitle,
            comment: ctx.comment,
          },
          relatedRef: {
            kind:
              ctx.kind === 'REFLECTION_CARD'
                ? COLLECTIONS.reflectionCards
                : COLLECTIONS.conductReviews,
            id: ctx.documentId,
          },
          now: ctx.now,
          channels: ctx.settings.notifications,
        });
        break;
      }

      default: {
        const exhaustive: never = effect;
        throw new Error(`未處理的 effect：${JSON.stringify(exhaustive)}`);
      }
    }
  }
}

async function liftPendingReviewRestrictions(
  firestore: Firestore,
  studentId: string,
  fromDate: string,
  clock: Clock,
): Promise<void> {
  const snap = await col(firestore, COLLECTIONS.recessRestrictions)
    .where('studentId', '==', studentId)
    .where('status', '==', 'ACTIVE')
    .where('date', '>=', fromDate)
    .get();
  await Promise.all(
    snap.docs.map((doc) =>
      liftRestriction(
        firestore,
        {
          studentId,
          date: doc.get('date') as string,
          reason: RESTRICTION_REASONS.OBSERVER_REVIEW_PENDING,
          note: '行為檢討書已通過雙重審核，恢復自由下課',
        },
        clock,
      ),
    ),
  );
}

/* ------------------------------ 驗證輔助 ------------------------------ */

/** 導師僅能簽核自己班級的案件（生教組與管理者不受限） */
async function assertTeacherOwnsClass(
  firestore: Firestore,
  params: ReviewParams,
  classId: string,
): Promise<void> {
  if (params.stage !== APPROVAL_STAGES.HOMEROOM_TEACHER) return;
  if (params.actor.roles.includes('ADMIN') || params.actor.roles.includes('DISCIPLINE_STAFF')) return;
  const klass = await col(firestore, COLLECTIONS.classes).doc(classId).get();
  if (klass.get('homeroomTeacherUid') !== params.actor.uid) {
    throw precondition('僅該班導師可簽章本案件');
  }
}

/** 必填題檢核：依模板 schema 驗證，避免學生草率送出空白反思卡 */
async function assertAnswersComplete(
  firestore: Firestore,
  templateId: string,
  answers: Record<string, unknown>,
): Promise<void> {
  const snap = await col(firestore, COLLECTIONS.formTemplates).doc(templateId).get();
  if (!snap.exists) throw notFound(`表單模板 ${templateId}`);
  const sections = (snap.get('sections') as Array<{
    questions: Array<{ id: string; label: string; required?: boolean; minLength?: number }>;
  }>) ?? [];

  for (const section of sections) {
    for (const question of section.questions ?? []) {
      const value = answers[question.id];
      if (question.required && (value === undefined || value === null || value === '')) {
        throw invalid(`「${question.label}」為必填`);
      }
      if (
        question.minLength &&
        typeof value === 'string' &&
        value.trim().length < question.minLength
      ) {
        throw invalid(`「${question.label}」至少需 ${question.minLength} 字`);
      }
    }
  }
}

async function templateTitle(firestore: Firestore, templateId: string): Promise<string> {
  const snap = await col(firestore, COLLECTIONS.formTemplates).doc(templateId).get();
  return (snap.get('title') as string) ?? '反思卡';
}

/** 供 handlers 重用的文件參照 */
export function cardRef(firestore: Firestore, cardId: string): DocumentReference {
  return col(firestore, COLLECTIONS.reflectionCards).doc(cardId);
}
