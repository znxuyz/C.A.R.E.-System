/**
 * 再犯偵測服務（Firestore 交易實作）
 * ==================================
 *
 * 規格：每筆違規成立時，回溯 15 天（含當天）該生的違規紀錄；
 *       達 3 次即發出警示並自動排入『安全觀察員追蹤清單』。
 *
 * 為何整段包在 Transaction 內：
 *   同一節下課可能連續登錄兩筆違規；若「讀取視窗 → 判定 → 建立警示」
 *   不是原子操作，會產生兩張警示、導致同一波違規被罰兩次。
 *   交易 + 認列（consumedByAlertId）讓整個流程具備幂等性。
 */
import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, col } from '../data/collections.js';
import {
  getStudent,
  loadCalendar,
  loadSettings,
  readRecidivismWindow,
  type StudentRecord,
} from '../data/repositories.js';
import { addDays, nextSchoolDay } from '../domain/dates.js';
import { buildAlert, evaluateRecidivism, type RecidivismConfig } from '../domain/recidivism.js';
import {
  ASSIGNMENT_STATUS,
  RESTRICTION_REASONS,
  type ObserverAssignment,
  type SchoolDate,
  type SystemSettings,
} from '../domain/types.js';
import type { Clock } from '../lib/clock.js';
import { freezeRecess } from './restrictionService.js';

export interface EvaluateResult {
  triggered: boolean;
  count: number;
  shortfall: number;
  windowStart: SchoolDate;
  windowEnd: SchoolDate;
  alertId?: string;
  assignmentId?: string;
  dutyOn?: SchoolDate;
}

/**
 * 評估並（必要時）觸發再犯處分。
 *
 * @param asOf 基準日（= 觸發違規的 occurredOn）
 */
export async function evaluateAndTrigger(
  firestore: Firestore,
  params: {
    studentId: string;
    asOf: SchoolDate;
    triggerInfractionId: string;
    student?: StudentRecord;
    settings?: SystemSettings;
  },
  clock: Clock,
): Promise<EvaluateResult> {
  const settings = params.settings ?? (await loadSettings(firestore));
  const student = params.student ?? (await getStudent(firestore, params.studentId));
  const config: RecidivismConfig = {
    windowDays: settings.recidivismWindowDays,
    threshold: settings.recidivismThreshold,
  };

  // 值勤日預設為「下一個上課日」，故需載入近月校曆
  const today = clock.today();
  const calendar = await loadCalendar(firestore, today, addDays(today, 45));
  const now = clock.now();

  const outcome = await firestore.runTransaction(async (tx) => {
    const windowStart = addDays(params.asOf, -(config.windowDays - 1));

    // ---- 讀取階段（Firestore 要求交易內先讀後寫）----
    const rows = await readRecidivismWindow(firestore, tx, {
      studentId: params.studentId,
      windowStart,
      windowEnd: params.asOf,
    });

    const evaluation = evaluateRecidivism({
      studentId: params.studentId,
      asOf: params.asOf,
      infractions: rows.map((r) => r.infraction),
      config,
    });

    if (!evaluation.triggered) {
      return {
        triggered: false,
        count: evaluation.count,
        shortfall: evaluation.shortfall,
        windowStart: evaluation.windowStart,
        windowEnd: evaluation.windowEnd,
      } satisfies EvaluateResult;
    }

    // ---- 寫入階段 ----
    const alertRef = col(firestore, COLLECTIONS.recidivismAlerts).doc();
    const assignmentRef = col(firestore, COLLECTIONS.observerAssignments).doc();
    const dutyOn = nextSchoolDay(today, calendar);

    const alert = buildAlert({
      evaluation,
      triggerInfractionId: params.triggerInfractionId,
      student: {
        id: student.id,
        studentNo: student.studentNo,
        name: student.name,
        classId: student.classId,
        className: student.className,
      },
      now,
    });

    tx.set(alertRef, {
      ...alert,
      // 規格：觸發後即「自動排入安全觀察員追蹤清單」
      status: 'ASSIGNED',
      assignmentId: assignmentRef.id,
    });

    // 認列：本次計入的違規不再參與後續視窗計數
    for (const row of rows) {
      if (evaluation.counted.some((item) => item.id === row.infraction.id)) {
        tx.update(row.ref, { consumedByAlertId: alertRef.id, updatedAt: now });
      }
    }

    const assignment: Omit<ObserverAssignment, 'id'> = {
      alertId: alertRef.id,
      studentId: student.id,
      studentNo: student.studentNo,
      studentName: student.name,
      classId: student.classId,
      className: student.className,
      dutyOn,
      totalPeriods: settings.observerPeriods,
      periodLogs: settings.observerPeriodNumbers.map((periodNo) => ({ periodNo })),
      status: ASSIGNMENT_STATUS.SCHEDULED,
      createdAt: now,
      updatedAt: now,
    };
    tx.set(assignmentRef, assignment);

    return {
      triggered: true,
      count: evaluation.count,
      shortfall: 0,
      windowStart: evaluation.windowStart,
      windowEnd: evaluation.windowEnd,
      alertId: alertRef.id,
      assignmentId: assignmentRef.id,
      dutyOn,
    } satisfies EvaluateResult;
  });

  if (!outcome.triggered) return outcome;

  // ---- 交易外：凍結值勤日的下課權限 ----
  await freezeRecess(
    firestore,
    {
      student,
      date: outcome.dutyOn!,
      reason: RESTRICTION_REASONS.OBSERVER_DUTY,
      periods: settings.observerPeriodNumbers,
      sourceRef: { assignmentId: outcome.assignmentId },
      note: '安全觀察員值勤（一日下課共 5 節，扣除打掃時間與 5 分鐘短下課）',
    },
    clock,
  );

  return outcome;
}

/**
 * 只讀評估（不寫入），供「再犯進度 / 關注名單」即時顯示，
 * 以及免記、撤銷後重新計算目前次數。
 */
export async function peekProgress(
  firestore: Firestore,
  params: { studentId: string; asOf: SchoolDate },
): Promise<{ count: number; threshold: number; shortfall: number; windowStart: SchoolDate; windowEnd: SchoolDate }> {
  const settings = await loadSettings(firestore);
  const windowStart = addDays(params.asOf, -(settings.recidivismWindowDays - 1));

  const snap = await col(firestore, COLLECTIONS.infractions)
    .where('studentId', '==', params.studentId)
    .where('countsTowardRecidivism', '==', true)
    .where('consumedByAlertId', '==', null)
    .where('status', 'in', ['OPEN', 'DONE'])
    .where('occurredOn', '>=', windowStart)
    .where('occurredOn', '<=', params.asOf)
    .get();

  const count = snap.size;
  return {
    count,
    threshold: settings.recidivismThreshold,
    shortfall: Math.max(0, settings.recidivismThreshold - count),
    windowStart,
    windowEnd: params.asOf,
  };
}
