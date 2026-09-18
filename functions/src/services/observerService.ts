/**
 * 安全觀察員制度管理
 *
 * 規格：
 *  - 觸發再犯門檻的學生強制執行「一日下課（共 5 節，扣除打掃時間與 5 分鐘下課）」
 *    至學務處擔任安全觀察員，協助觀察走廊奔跑同學。
 *  - 值勤結束後提交**紙本**行為檢討書；生教組長於系統標記回收，
 *    系統即安排**隔日（下一個上課日）**解鎖、恢復自由下課。
 */
import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, col } from '../data/collections.js';
import { getStudent, loadCalendar, loadSettings, writeAuditLog } from '../data/repositories.js';
import { unlockDateForReviewReturn } from '../domain/caseRules.js';
import { addDays } from '../domain/dates.js';
import {
  ASSIGNMENT_STATUS,
  RESTRICTION_REASONS,
  type ObserverAssignment,
  type ObserverPeriodLog,
  type SchoolDate,
} from '../domain/types.js';
import type { Clock } from '../lib/clock.js';
import { invalid, notFound, precondition } from '../lib/errors.js';
import { freezeRecess, liftFrom, liftRestriction } from './restrictionService.js';

export async function getAssignment(
  firestore: Firestore,
  assignmentId: string,
): Promise<ObserverAssignment> {
  const snap = await col(firestore, COLLECTIONS.observerAssignments).doc(assignmentId).get();
  if (!snap.exists) throw notFound(`安全觀察員派單 ${assignmentId}`);
  return { id: snap.id, ...(snap.data() as Omit<ObserverAssignment, 'id'>) };
}

/** 改期（值勤日臨時校外教學、學生請假等） */
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

/** 各節下課報到 / 離開（學務處值勤台一鍵打卡） */
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
    logs[index] = { ...current, checkInAt: now };
  } else {
    if (!current.checkInAt) throw precondition(`第 ${params.periodNo} 節尚未報到`);
    logs[index] = {
      ...current,
      checkOutAt: now,
      observedCount: params.observedCount ?? current.observedCount ?? 0,
      note: params.note ?? current.note,
    };
  }

  const completedPeriods = logs.filter((log) => Boolean(log.checkOutAt)).length;
  const allDone = completedPeriods >= assignment.totalPeriods;

  await col(firestore, COLLECTIONS.observerAssignments).doc(assignment.id).update({
    periodLogs: logs,
    status: allDone ? ASSIGNMENT_STATUS.DUTY_COMPLETED : ASSIGNMENT_STATUS.IN_PROGRESS,
    updatedAt: now,
  });

  return {
    status: allDone ? ASSIGNMENT_STATUS.DUTY_COMPLETED : ASSIGNMENT_STATUS.IN_PROGRESS,
    completedPeriods,
  };
}

/**
 * 紙本行為檢討書回收 → 安排隔日（下一個上課日）解鎖。
 * 解鎖日當天起不再建立管制帳；解鎖日之後既有的管制一併解除。
 */
export async function markReviewReturned(
  firestore: Firestore,
  params: { assignmentId: string; actor: { uid: string; name: string } },
  clock: Clock,
): Promise<{ unlockOn: SchoolDate }> {
  const assignment = await getAssignment(firestore, params.assignmentId);
  if (assignment.status === ASSIGNMENT_STATUS.CLOSED) throw precondition('派單已結案');
  if (assignment.status === ASSIGNMENT_STATUS.SCHEDULED) {
    throw precondition('尚未開始值勤，無法回收行為檢討書');
  }

  const now = clock.now();
  const returnedOn = clock.today();
  const calendar = await loadCalendar(firestore, returnedOn, addDays(returnedOn, 45));
  const unlockOn = unlockDateForReviewReturn(returnedOn, calendar);

  await col(firestore, COLLECTIONS.observerAssignments).doc(assignment.id).update({
    status: ASSIGNMENT_STATUS.CLOSED,
    reviewReturnedAt: now,
    reviewReturnedOn: returnedOn,
    unlockOn,
    updatedAt: now,
  });

  await col(firestore, COLLECTIONS.recidivismAlerts).doc(assignment.alertId).update({
    status: 'CLOSED',
    updatedAt: now,
  });

  // 解鎖日起不再管制
  await liftFrom(
    firestore,
    {
      studentId: assignment.studentId,
      fromDate: unlockOn,
      reason: RESTRICTION_REASONS.OBSERVER_REVIEW_PENDING,
      note: '行為檢討書已回收，恢復自由下課',
    },
    clock,
  );

  await writeAuditLog(firestore, {
    actorUid: params.actor.uid,
    actorName: params.actor.name,
    action: 'OBSERVER_REVIEW_RETURNED',
    entityType: COLLECTIONS.observerAssignments,
    entityId: assignment.id,
    after: { returnedOn, unlockOn },
    at: now,
  });

  return { unlockOn };
}

/** 撤銷誤判之再犯警示（同時取消派單並釋回違規認列） */
export async function dismissAlert(
  firestore: Firestore,
  params: { alertId: string; reason: string; actor: { uid: string; name: string } },
  clock: Clock,
): Promise<void> {
  if (!params.reason.trim()) throw invalid('撤銷警示必須填寫理由');
  const alertRef = col(firestore, COLLECTIONS.recidivismAlerts).doc(params.alertId);
  const alertSnap = await alertRef.get();
  if (!alertSnap.exists) throw notFound(`再犯警示 ${params.alertId}`);

  const now = clock.now();
  const infractionIds = (alertSnap.get('infractionIds') as string[]) ?? [];
  const assignmentId = alertSnap.get('assignmentId') as string | undefined;
  const studentId = alertSnap.get('studentId') as string;

  const batch = firestore.batch();
  batch.update(alertRef, {
    status: 'DISMISSED',
    note: params.reason,
    updatedAt: now,
  });
  // 釋回認列：違規回到可計數狀態（避免誤判後永久吃掉 3 次額度）
  for (const infractionId of infractionIds) {
    batch.update(col(firestore, COLLECTIONS.infractions).doc(infractionId), {
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
        note: `再犯警示撤銷：${params.reason}`,
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

/** 安全觀察員追蹤清單 */
export async function listTrackingList(
  firestore: Firestore,
  params: { limit?: number } = {},
): Promise<ObserverAssignment[]> {
  const snap = await col(firestore, COLLECTIONS.observerAssignments)
    .where('status', 'in', [
      ASSIGNMENT_STATUS.SCHEDULED,
      ASSIGNMENT_STATUS.IN_PROGRESS,
      ASSIGNMENT_STATUS.DUTY_COMPLETED,
    ])
    .orderBy('dutyOn', 'asc')
    .limit(params.limit ?? 100)
    .get();
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<ObserverAssignment, 'id'>) }));
}
