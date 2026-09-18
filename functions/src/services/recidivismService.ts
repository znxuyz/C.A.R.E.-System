/**
 * 累犯偵測服務（Firestore 交易實作）
 * ==================================
 *
 * 規格：每筆違規成立時，回溯 15 天（含當天）該生反思卡填寫紀錄；
 *       達 3 張即發出警示並自動排入『安全觀察員追蹤清單』。
 *
 * 為何整段包在 Transaction 內：
 *   學生可能在同一節下課連續送出兩張卡（或生教組同時蓋章兩案），
 *   若「讀取視窗 → 判定 → 建立警示」不是原子操作，會產生兩張警示、
 *   導致同一波違規被罰兩次。交易 + 卡片認列（consumedByAlertId）
 *   讓整個流程具備幂等性。
 */
import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, col } from '../data/collections.js';
import {
  loadCalendar,
  loadSettings,
  getStudent,
  readRecidivismWindowCards,
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
import { notify, resolveRecipients } from '../notifications/notifier.js';
import { freezeRecess } from './restrictionService.js';

export interface EvaluateResult {
  triggered: boolean;
  cardCount: number;
  shortfall: number;
  windowStart: SchoolDate;
  windowEnd: SchoolDate;
  alertId?: string;
  assignmentId?: string;
  dutyOn?: SchoolDate;
}

/**
 * 評估並（必要時）觸發累犯處分。
 *
 * @param asOf       基準日（= 觸發卡片的 countOn，亦即違規發生日）
 * @param triggerCardId 觸發本次評估的卡片
 */
export async function evaluateAndTrigger(
  firestore: Firestore,
  params: {
    studentId: string;
    asOf: SchoolDate;
    triggerCardId: string;
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
    const { windowStart, windowEnd } = {
      windowStart: addDays(params.asOf, -(config.windowDays - 1)),
      windowEnd: params.asOf,
    };

    // ---- 讀取階段（Firestore 要求交易內先讀後寫）----
    const rows = await readRecidivismWindowCards(firestore, tx, {
      studentId: params.studentId,
      windowStart,
      windowEnd,
    });

    const evaluation = evaluateRecidivism({
      studentId: params.studentId,
      asOf: params.asOf,
      cards: rows.map((r) => r.card),
      config,
    });

    if (!evaluation.triggered) {
      return {
        triggered: false,
        cardCount: evaluation.cardCount,
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
      triggerCardId: params.triggerCardId,
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

    // 認列卡片：本次計入的卡片不再參與後續視窗計數
    for (const row of rows) {
      if (evaluation.countedCards.some((card) => card.id === row.card.id)) {
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
      cardCount: evaluation.cardCount,
      shortfall: 0,
      windowStart: evaluation.windowStart,
      windowEnd: evaluation.windowEnd,
      alertId: alertRef.id,
      assignmentId: assignmentRef.id,
      dutyOn,
    } satisfies EvaluateResult;
  });

  if (!outcome.triggered) return outcome;

  // ---- 交易外的後續作業（凍結值勤日下課、發警示通知）----
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

  const context = {
    studentName: student.name,
    studentNo: student.studentNo,
    className: student.className,
    windowDays: settings.recidivismWindowDays,
    cardCount: outcome.cardCount,
    dutyOn: outcome.dutyOn,
  };

  for (const audience of ['DISCIPLINE_OFFICE', 'HOMEROOM_TEACHER'] as const) {
    const recipients = await resolveRecipients(firestore, audience, {
      classId: student.classId,
      studentId: student.id,
    });
    if (recipients.length === 0) continue;
    await notify(firestore, {
      templateCode: 'RECIDIVISM_ALERT',
      audience,
      recipients,
      context,
      relatedRef: { kind: 'recidivismAlerts', id: outcome.alertId! },
      now,
      channels: settings.notifications,
    });
  }

  const studentRecipients = await resolveRecipients(firestore, 'STUDENT', {
    studentId: student.id,
  });
  if (studentRecipients.length > 0) {
    await notify(firestore, {
      templateCode: 'OBSERVER_ASSIGNED',
      audience: 'STUDENT',
      recipients: studentRecipients,
      context,
      relatedRef: { kind: 'observerAssignments', id: outcome.assignmentId! },
      now,
      channels: settings.notifications,
    });
  }

  return outcome;
}

/**
 * 只讀評估（不寫入），供生教組端「累犯進度 / 關注名單」即時顯示，
 * 以及豁免、撤銷後重新計算目前張數。
 */
export async function peekProgress(
  firestore: Firestore,
  params: { studentId: string; asOf: SchoolDate },
): Promise<{ cardCount: number; shortfall: number; windowStart: SchoolDate; windowEnd: SchoolDate }> {
  const settings = await loadSettings(firestore);
  const windowStart = addDays(params.asOf, -(settings.recidivismWindowDays - 1));

  const snap = await col(firestore, COLLECTIONS.reflectionCards)
    .where('studentId', '==', params.studentId)
    .where('countsTowardRecidivism', '==', true)
    .where('consumedByAlertId', '==', null)
    .where('status', 'in', ['PENDING_TEACHER', 'PENDING_OFFICE', 'COMPLETED'])
    .where('countOn', '>=', windowStart)
    .where('countOn', '<=', params.asOf)
    .get();

  const cardCount = snap.size;
  return {
    cardCount,
    shortfall: Math.max(0, settings.recidivismThreshold - cardCount),
    windowStart,
    windowEnd: params.asOf,
  };
}
