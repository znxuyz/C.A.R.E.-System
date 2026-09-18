/**
 * 安全觀察員制度管理
 *
 * 規格：
 *  - 被觸發累犯的學生強制執行「一日下課（共 5 節，扣除打掃時間與 5 分鐘下課）」
 *    至學務處擔任安全觀察員，協助觀察走廊奔跑同學。
 *  - 值勤結束後須提交『行為檢討書』，經導師簽章 + 生教組蓋章，
 *    通過後的**隔日**系統才解鎖、恢復自由下課。
 */
import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, col } from '../data/collections.js';
import {
  getStudent,
  loadCalendar,
  loadSettings,
  writeAuditLog,
} from '../data/repositories.js';
import { addDays } from '../domain/dates.js';
import {
  ASSIGNMENT_STATUS,
  CASE_STATUS,
  FORM_KINDS,
  RESTRICTION_REASONS,
  type ConductReview,
  type ObserverAssignment,
  type ObserverPeriodLog,
  type SchoolDate,
} from '../domain/types.js';
import type { Clock } from '../lib/clock.js';
import { invalid, notFound, precondition } from '../lib/errors.js';
import { notify, resolveRecipients } from '../notifications/notifier.js';
import { freezeRecess, liftRestriction } from './restrictionService.js';

async function getAssignment(
  firestore: Firestore,
  assignmentId: string,
): Promise<ObserverAssignment> {
  const snap = await col(firestore, COLLECTIONS.observerAssignments).doc(assignmentId).get();
  if (!snap.exists) throw notFound(`安全觀察員派單 ${assignmentId}`);
  return { id: snap.id, ...(snap.data() as Omit<ObserverAssignment, 'id'>) };
}

/** 生教組改期（例如值勤日臨時校外教學） */
export async function rescheduleDuty(
  firestore: Firestore,
  params: {
    assignmentId: string;
    dutyOn: SchoolDate;
    reason: string;
    actor: { uid: string; name: string };
  },
  clock: Clock,
): Promise<void> {
  const assignment = await getAssignment(firestore, params.assignmentId);
  if (assignment.status === ASSIGNMENT_STATUS.CLOSED) {
    throw precondition('派單已結案，不可改期');
  }
  const [settings, student] = await Promise.all([
    loadSettings(firestore),
    getStudent(firestore, assignment.studentId),
  ]);
  const calendar = await loadCalendar(firestore, params.dutyOn, addDays(params.dutyOn, 1));
  if (!calendar.isSchoolDay(params.dutyOn)) {
    throw invalid(`${params.dutyOn} 非上課日，無法排定值勤`);
  }

  const now = clock.now();
  // 舊值勤日解除管制，新值勤日重新凍結
  await liftRestriction(
    firestore,
    {
      studentId: assignment.studentId,
      date: assignment.dutyOn,
      reason: RESTRICTION_REASONS.OBSERVER_DUTY,
      note: `值勤改期至 ${params.dutyOn}：${params.reason}`,
    },
    clock,
  );
  await freezeRecess(
    firestore,
    {
      student,
      date: params.dutyOn,
      reason: RESTRICTION_REASONS.OBSERVER_DUTY,
      periods: settings.observerPeriodNumbers,
      sourceRef: { assignmentId: assignment.id },
      note: '安全觀察員值勤（改期）',
    },
    clock,
  );
  await col(firestore, COLLECTIONS.observerAssignments).doc(assignment.id).update({
    dutyOn: params.dutyOn,
    rescheduleReason: params.reason,
    updatedAt: now,
  });

  await writeAuditLog(firestore, {
    actorUid: params.actor.uid,
    actorName: params.actor.name,
    action: 'OBSERVER_DUTY_RESCHEDULED',
    entityType: COLLECTIONS.observerAssignments,
    entityId: assignment.id,
    before: { dutyOn: assignment.dutyOn },
    after: { dutyOn: params.dutyOn, reason: params.reason },
    at: now,
  });
}

/** 各節下課報到 / 離開（學務處值勤台操作） */
export async function logPeriod(
  firestore: Firestore,
  params: {
    assignmentId: string;
    periodNo: number;
    action: 'CHECK_IN' | 'CHECK_OUT';
    observedCount?: number;
    note?: string;
    actor: { uid: string; name: string };
  },
  clock: Clock,
): Promise<{ status: string; completedPeriods: number }> {
  const assignment = await getAssignment(firestore, params.assignmentId);
  if (assignment.status === ASSIGNMENT_STATUS.CLOSED) throw precondition('派單已結案');

  const now = clock.now();
  const logs: ObserverPeriodLog[] = [...(assignment.periodLogs ?? [])];
  const index = logs.findIndex((log) => log.periodNo === params.periodNo);
  if (index < 0) throw invalid(`派單不含第 ${params.periodNo} 節`);

  const current = logs[index]!;
  if (params.action === 'CHECK_IN') {
    if (current.checkInAt) throw precondition(`第 ${params.periodNo} 節已報到`);
    logs[index] = { ...current, checkInAt: now, verifiedByUid: params.actor.uid };
  } else {
    if (!current.checkInAt) throw precondition(`第 ${params.periodNo} 節尚未報到`);
    logs[index] = {
      ...current,
      checkOutAt: now,
      observedCount: params.observedCount ?? current.observedCount ?? 0,
      note: params.note ?? current.note,
      verifiedByUid: params.actor.uid,
    };
  }

  const completedPeriods = logs.filter((log) => Boolean(log.checkOutAt)).length;
  const allDone = completedPeriods >= assignment.totalPeriods;

  await col(firestore, COLLECTIONS.observerAssignments).doc(assignment.id).update({
    periodLogs: logs,
    status: allDone ? ASSIGNMENT_STATUS.DUTY_COMPLETED : ASSIGNMENT_STATUS.IN_PROGRESS,
    supervisor: { uid: params.actor.uid, name: params.actor.name },
    updatedAt: now,
  });

  // 值勤完成 → 自動開立行為檢討書供學生填寫
  if (allDone && !assignment.conductReviewId) {
    await createConductReview(firestore, assignment.id, clock);
  }

  return {
    status: allDone ? ASSIGNMENT_STATUS.DUTY_COMPLETED : ASSIGNMENT_STATUS.IN_PROGRESS,
    completedPeriods,
  };
}

/** 開立行為檢討書（值勤完成時自動呼叫；亦可由生教組手動補開） */
export async function createConductReview(
  firestore: Firestore,
  assignmentId: string,
  clock: Clock,
): Promise<string> {
  const assignment = await getAssignment(firestore, assignmentId);
  if (assignment.conductReviewId) return assignment.conductReviewId;

  const templateSnap = await col(firestore, COLLECTIONS.formTemplates)
    .where('kind', '==', FORM_KINDS.CONDUCT_REVIEW)
    .where('active', '==', true)
    .limit(1)
    .get();
  const template = templateSnap.docs[0];
  if (!template) throw notFound('行為檢討書模板');

  const now = clock.now();
  const reviewRef = col(firestore, COLLECTIONS.conductReviews).doc();
  const review: Omit<ConductReview, 'id'> = {
    assignmentId: assignment.id,
    studentId: assignment.studentId,
    studentNo: assignment.studentNo,
    studentName: assignment.studentName,
    classId: assignment.classId,
    templateId: template.id,
    templateVersion: (template.get('version') as number) ?? 1,
    status: CASE_STATUS.DRAFT,
    answers: {},
    approvals: [],
    returnCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  const batch = firestore.batch();
  batch.set(reviewRef, review);
  batch.update(col(firestore, COLLECTIONS.observerAssignments).doc(assignment.id), {
    conductReviewId: reviewRef.id,
    status: ASSIGNMENT_STATUS.DUTY_COMPLETED,
    updatedAt: now,
  });
  await batch.commit();

  const recipients = await resolveRecipients(firestore, 'STUDENT', {
    studentId: assignment.studentId,
  });
  if (recipients.length > 0) {
    const settings = await loadSettings(firestore);
    await notify(firestore, {
      templateCode: 'CONDUCT_REVIEW_SUBMITTED_TO_TEACHER',
      audience: 'STUDENT',
      recipients,
      context: {
        studentName: assignment.studentName,
        studentNo: assignment.studentNo,
        className: assignment.className,
        cardTitle: '行為檢討書',
        dutyOn: assignment.dutyOn,
      },
      relatedRef: { kind: COLLECTIONS.conductReviews, id: reviewRef.id },
      now,
      channels: settings.notifications,
    });
  }

  return reviewRef.id;
}

/** 生教組撤銷誤判之累犯警示（同時取消派單並釋回卡片認列） */
export async function dismissAlert(
  firestore: Firestore,
  params: { alertId: string; reason: string; actor: { uid: string; name: string } },
  clock: Clock,
): Promise<void> {
  const alertRef = col(firestore, COLLECTIONS.recidivismAlerts).doc(params.alertId);
  const alertSnap = await alertRef.get();
  if (!alertSnap.exists) throw notFound(`累犯警示 ${params.alertId}`);
  const now = clock.now();
  const cardIds = (alertSnap.get('cardIds') as string[]) ?? [];
  const assignmentId = alertSnap.get('assignmentId') as string | undefined;
  const studentId = alertSnap.get('studentId') as string;

  const batch = firestore.batch();
  batch.update(alertRef, {
    status: 'DISMISSED',
    note: params.reason,
    dismissedBy: { uid: params.actor.uid, name: params.actor.name, at: now },
    updatedAt: now,
  });
  // 釋回認列：卡片回到可計數狀態（避免誤判後永久吃掉 3 張額度）
  for (const cardId of cardIds) {
    batch.update(col(firestore, COLLECTIONS.reflectionCards).doc(cardId), {
      consumedByAlertId: null,
      updatedAt: now,
    });
  }
  if (assignmentId) {
    batch.update(col(firestore, COLLECTIONS.observerAssignments).doc(assignmentId), {
      status: ASSIGNMENT_STATUS.CANCELLED,
      updatedAt: now,
    });
  }
  await batch.commit();

  if (assignmentId) {
    const assignment = await getAssignment(firestore, assignmentId);
    await liftRestriction(
      firestore,
      {
        studentId,
        date: assignment.dutyOn,
        reason: RESTRICTION_REASONS.OBSERVER_DUTY,
        note: `累犯警示撤銷：${params.reason}`,
      },
      clock,
    );
  }

  await writeAuditLog(firestore, {
    actorUid: params.actor.uid,
    actorName: params.actor.name,
    action: 'RECIDIVISM_ALERT_DISMISSED',
    entityType: COLLECTIONS.recidivismAlerts,
    entityId: params.alertId,
    after: { reason: params.reason },
    at: now,
  });
}

/** 安全觀察員追蹤清單（生教組端） */
export async function listTrackingList(
  firestore: Firestore,
  params: { from?: SchoolDate; to?: SchoolDate; limit?: number } = {},
): Promise<ObserverAssignment[]> {
  let query = col(firestore, COLLECTIONS.observerAssignments).where('status', 'in', [
    ASSIGNMENT_STATUS.SCHEDULED,
    ASSIGNMENT_STATUS.IN_PROGRESS,
    ASSIGNMENT_STATUS.DUTY_COMPLETED,
    ASSIGNMENT_STATUS.REVIEW_PENDING,
  ]);
  if (params.from) query = query.where('dutyOn', '>=', params.from);
  if (params.to) query = query.where('dutyOn', '<=', params.to);
  const snap = await query.orderBy('dutyOn', 'asc').limit(params.limit ?? 100).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<ObserverAssignment, 'id'>) }));
}
