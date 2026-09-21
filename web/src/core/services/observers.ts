/**
 * 安全觀察員：值勤打卡、紙本行為檢討書回收（隔日解鎖）、警示撤銷
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { COL } from '../firestore/paths.js';
import { unlockDateForReviewReturn } from '../domain/caseRules.js';
import { addDays, type SchoolCalendar } from '../domain/dates.js';
import {
  ASSIGNMENT_STATUS,
  RESTRICTION_REASONS,
  type ObserverPeriodLog,
  type RecidivismWindowEntry,
  type SchoolDate,
  type SystemSettings,
} from '../domain/types.js';
import { auditDoc, type Ctx } from './context.js';
import { freezeRecess, liftFrom, liftRestriction } from './restrictions.js';

async function getAssignment(ctx: Ctx, assignmentId: string) {
  const snap = await getDoc(doc(ctx.db, COL.observerAssignments, assignmentId));
  if (!snap.exists()) throw new Error('查無安全觀察員派單');
  return { id: snap.id, ...snap.data() } as Record<string, unknown> & { id: string };
}

/** 各節下課報到 / 離開 */
export async function logPeriod(
  ctx: Ctx,
  params: {
    assignmentId: string;
    periodNo: number;
    action: 'CHECK_IN' | 'CHECK_OUT';
    observedCount?: number;
    note?: string;
  },
): Promise<{ status: string; completedPeriods: number }> {
  const ref = doc(ctx.db, COL.observerAssignments, params.assignmentId);

  return runTransaction(ctx.db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('查無安全觀察員派單');
    if (snap.get('status') === ASSIGNMENT_STATUS.CLOSED) throw new Error('派單已結案');

    const logs: ObserverPeriodLog[] = [...((snap.get('periodLogs') as ObserverPeriodLog[]) ?? [])];
    const index = logs.findIndex((log) => log.periodNo === params.periodNo);
    if (index < 0) throw new Error(`派單不含第 ${params.periodNo} 節`);

    const current = logs[index]!;
    const now = ctx.clock.now();
    if (params.action === 'CHECK_IN') {
      if (current.checkInAt) throw new Error(`第 ${params.periodNo} 節已報到`);
      logs[index] = { ...current, checkInAt: now };
    } else {
      if (!current.checkInAt) throw new Error(`第 ${params.periodNo} 節尚未報到`);
      logs[index] = {
        ...current,
        checkOutAt: now,
        observedCount: params.observedCount ?? current.observedCount ?? 0,
        note: params.note ?? current.note ?? null,
      } as ObserverPeriodLog;
    }

    const completedPeriods = logs.filter((log) => Boolean(log.checkOutAt)).length;
    const allDone = completedPeriods >= (snap.get('totalPeriods') as number);
    const status = allDone ? ASSIGNMENT_STATUS.DUTY_COMPLETED : ASSIGNMENT_STATUS.IN_PROGRESS;

    tx.update(ref, { periodLogs: logs, status, updatedAt: serverTimestamp() });
    return { status, completedPeriods };
  });
}

/** 紙本行為檢討書回收 → 隔日（下一個上課日）解鎖 */
export async function markReviewReturned(
  ctx: Ctx,
  assignmentId: string,
  calendar: SchoolCalendar,
): Promise<{ unlockOn: SchoolDate }> {
  const assignment = await getAssignment(ctx, assignmentId);
  if (assignment.status === ASSIGNMENT_STATUS.CLOSED) throw new Error('派單已結案');
  if (assignment.status === ASSIGNMENT_STATUS.SCHEDULED) {
    throw new Error('尚未開始值勤，無法回收行為檢討書');
  }

  const returnedOn = ctx.clock.today();
  const unlockOn = unlockDateForReviewReturn(returnedOn, calendar);

  await updateDoc(doc(ctx.db, COL.observerAssignments, assignmentId), {
    status: ASSIGNMENT_STATUS.CLOSED,
    reviewReturnedAt: serverTimestamp(),
    reviewReturnedOn: returnedOn,
    unlockOn,
    updatedAt: serverTimestamp(),
  });
  await updateDoc(doc(ctx.db, COL.recidivismAlerts, assignment.alertId as string), {
    status: 'CLOSED',
    updatedAt: serverTimestamp(),
  });
  await liftFrom(ctx, {
    studentId: assignment.studentId as string,
    fromDate: unlockOn,
    reason: RESTRICTION_REASONS.OBSERVER_REVIEW_PENDING,
    note: '行為檢討書已回收，恢復自由下課',
  });
  await addAudit(ctx, {
    action: 'OBSERVER_REVIEW_RETURNED',
    entityType: COL.observerAssignments,
    entityId: assignmentId,
    after: { returnedOn, unlockOn },
  });

  return { unlockOn };
}

/** 值勤改期 */
export async function rescheduleDuty(
  ctx: Ctx,
  params: { assignmentId: string; dutyOn: SchoolDate; reason: string },
  settings: SystemSettings,
  calendar: SchoolCalendar,
): Promise<void> {
  const assignment = await getAssignment(ctx, params.assignmentId);
  if (assignment.status === ASSIGNMENT_STATUS.CLOSED) throw new Error('派單已結案，不可改期');
  if (!calendar.isSchoolDay(params.dutyOn)) throw new Error(`${params.dutyOn} 非上課日，無法排定值勤`);

  const student = {
    id: assignment.studentId as string,
    studentNo: assignment.studentNo as string,
    name: assignment.studentName as string,
    classId: assignment.classId as string,
    className: assignment.className as string,
  };

  await liftRestriction(ctx, {
    studentId: student.id,
    date: assignment.dutyOn as SchoolDate,
    reason: RESTRICTION_REASONS.OBSERVER_DUTY,
    note: `值勤改期至 ${params.dutyOn}：${params.reason}`,
  });
  await freezeRecess(ctx, {
    student,
    date: params.dutyOn,
    reason: RESTRICTION_REASONS.OBSERVER_DUTY,
    periods: settings.observerPeriodNumbers,
    sourceRef: { assignmentId: params.assignmentId },
    note: '安全觀察員值勤（改期）',
  });
  await updateDoc(doc(ctx.db, COL.observerAssignments, params.assignmentId), {
    dutyOn: params.dutyOn,
    rescheduleReason: params.reason,
    updatedAt: serverTimestamp(),
  });
  await addAudit(ctx, {
    action: 'OBSERVER_DUTY_RESCHEDULED',
    entityType: COL.observerAssignments,
    entityId: params.assignmentId,
    before: { dutyOn: assignment.dutyOn },
    after: { dutyOn: params.dutyOn, reason: params.reason },
  });
}

/**
 * 撤銷誤判的再犯警示：
 * 取消派單、解除值勤日管制，並把認列的違規釋回學生的再犯視窗，
 * 避免一次誤判永久吃掉額度。
 */
export async function dismissAlert(
  ctx: Ctx,
  params: { alertId: string; reason: string },
  settings: SystemSettings,
): Promise<void> {
  if (!params.reason.trim()) throw new Error('撤銷警示必須填寫理由');
  const alertRef = doc(ctx.db, COL.recidivismAlerts, params.alertId);
  const alertSnap = await getDoc(alertRef);
  if (!alertSnap.exists()) throw new Error('查無再犯警示');

  const studentId = alertSnap.get('studentId') as string;
  const assignmentId = alertSnap.get('assignmentId') as string | undefined;
  const breakdown = (alertSnap.get('breakdown') as RecidivismWindowEntry[]) ?? [];
  const windowStart = addDays(ctx.clock.today(), -(settings.recidivismWindowDays - 1));
  const studentRef = doc(ctx.db, COL.students, studentId);

  await runTransaction(ctx.db, async (tx) => {
    const studentSnap = await tx.get(studentRef);
    const cached = (studentSnap.get('recidivismWindow') as RecidivismWindowEntry[]) ?? [];
    const restored = [
      ...cached,
      ...breakdown.filter((item) => item.occurredOn >= windowStart),
    ].filter(
      (item, index, all) =>
        all.findIndex((other) => other.infractionId === item.infractionId) === index,
    );

    tx.update(alertRef, { status: 'DISMISSED', note: params.reason, updatedAt: serverTimestamp() });
    for (const item of breakdown) {
      tx.update(doc(ctx.db, COL.infractions, item.infractionId), {
        consumedByAlertId: null,
        updatedAt: serverTimestamp(),
      });
    }
    tx.set(studentRef, { recidivismWindow: restored }, { merge: true });
    if (assignmentId) {
      tx.update(doc(ctx.db, COL.observerAssignments, assignmentId), {
        status: ASSIGNMENT_STATUS.CANCELLED,
        updatedAt: serverTimestamp(),
      });
    }
    tx.set(
      doc(collection(ctx.db, COL.auditLogs)),
      auditDoc(ctx, {
        action: 'RECIDIVISM_ALERT_DISMISSED',
        entityType: COL.recidivismAlerts,
        entityId: params.alertId,
        after: { reason: params.reason },
      }),
    );
  });

  if (assignmentId) {
    const assignment = await getAssignment(ctx, assignmentId);
    await liftRestriction(ctx, {
      studentId,
      date: assignment.dutyOn as SchoolDate,
      reason: RESTRICTION_REASONS.OBSERVER_DUTY,
      note: `再犯警示撤銷：${params.reason}`,
    });
  }
}

export async function listAssignments(ctx: Ctx, max = 100) {
  const snap = await getDocs(
    query(collection(ctx.db, COL.observerAssignments), orderBy('dutyOn', 'asc'), fsLimit(max)),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listAlerts(ctx: Ctx, max = 100) {
  const snap = await getDocs(
    query(collection(ctx.db, COL.recidivismAlerts), orderBy('triggeredAt', 'desc'), fsLimit(max)),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** 追蹤中的派單（儀表板與每日續帳用） */
export async function listOpenAssignments(ctx: Ctx) {
  const snap = await getDocs(
    query(
      collection(ctx.db, COL.observerAssignments),
      where('status', 'in', [
        ASSIGNMENT_STATUS.SCHEDULED,
        ASSIGNMENT_STATUS.IN_PROGRESS,
        ASSIGNMENT_STATUS.DUTY_COMPLETED,
      ]),
      orderBy('dutyOn', 'asc'),
      fsLimit(100),
    ),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function addAudit(
  ctx: Ctx,
  entry: { action: string; entityType: string; entityId: string; before?: unknown; after?: unknown },
) {
  const { addDoc } = await import('firebase/firestore');
  await addDoc(collection(ctx.db, COL.auditLogs), auditDoc(ctx, entry));
}
