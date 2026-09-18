/**
 * Callable Functions（前端唯一寫入管道）
 *
 * 設計原則：安全規則禁止 client 直接寫入業務集合，所有狀態變更都必須經由
 * 這些 callable，以保證：伺服器時戳、簽章雜湊、稽核軌跡、
 * 以及「累犯偵測必須在交易中執行」等不可繞過的規則。
 */
import { onCall } from 'firebase-functions/v2/https';
import { db } from '../lib/firebase.js';
import { systemClock } from '../lib/clock.js';
import { ROLES } from '../domain/types.js';
import { APPROVAL_STAGES } from '../domain/types.js';
import { logInfraction, voidInfraction } from '../services/infractionService.js';
import {
  reviewConductReview,
  reviewReflectionCard,
  submitConductReview,
  submitReflectionCard,
} from '../services/caseService.js';
import {
  dismissAlert,
  listTrackingList,
  logPeriod,
  rescheduleDuty,
} from '../services/observerService.js';
import { listRestrictionsOn } from '../services/restrictionService.js';
import { peekProgress } from '../services/recidivismService.js';
import { requireAuth, requireReporter, requireRole, toHttpsError } from './auth.js';

const OPTS = { region: 'asia-east1' as const, cors: true };

/* --------------------------- 1. 違規登錄與通報 --------------------------- */

/** 生教組 / 糾察隊 / 巡堂教師登錄違規 */
export const createInfraction = onCall(OPTS, async (request) => {
  const caller = requireReporter(request);
  try {
    return await logInfraction(
      db(),
      {
        studentNo: request.data?.studentNo,
        studentId: request.data?.studentId,
        typeCode: request.data?.typeCode,
        occurredAt: request.data?.occurredAt,
        periodNo: request.data?.periodNo,
        locationCode: request.data?.locationCode,
        locationDetail: request.data?.locationDetail,
        description: request.data?.description,
        reporter: { uid: caller.uid, name: caller.name, role: caller.roles[0] ?? ROLES.PATROL },
      },
      systemClock,
    );
  } catch (error) {
    throw toHttpsError(error);
  }
});

/** 撤銷誤報（生教組專屬） */
export const revokeInfraction = onCall(OPTS, async (request) => {
  const caller = requireRole(request, ROLES.DISCIPLINE_STAFF);
  try {
    await voidInfraction(
      db(),
      {
        infractionId: request.data?.infractionId,
        reason: request.data?.reason ?? '誤報撤銷',
        actor: { uid: caller.uid, name: caller.name },
      },
      systemClock,
    );
    return { ok: true };
  } catch (error) {
    throw toHttpsError(error);
  }
});

/* ---------------------------- 2. 反思卡工作流 ---------------------------- */

/** 學生送出反思卡 */
export const submitCard = onCall(OPTS, async (request) => {
  const caller = requireRole(request, ROLES.STUDENT);
  try {
    return await submitReflectionCard(
      db(),
      {
        cardId: request.data?.cardId,
        answers: request.data?.answers ?? {},
        actor: { uid: caller.uid, name: caller.name, roles: caller.roles },
      },
      systemClock,
    );
  } catch (error) {
    throw toHttpsError(error);
  }
});

/** 第一層：導師線上簽章（含「班級活動優先」勾選） */
export const teacherSignCard = onCall(OPTS, async (request) => {
  const caller = requireRole(request, ROLES.HOMEROOM_TEACHER);
  try {
    return await reviewReflectionCard(
      db(),
      {
        cardId: request.data?.cardId,
        stage: APPROVAL_STAGES.HOMEROOM_TEACHER,
        decision: request.data?.decision ?? 'SIGNED',
        comment: request.data?.comment,
        teacherActivityPriority: Boolean(request.data?.teacherActivityPriority),
        exemptReason: request.data?.exemptReason,
        actor: { uid: caller.uid, name: caller.name, roles: caller.roles },
      },
      systemClock,
    );
  } catch (error) {
    throw toHttpsError(error);
  }
});

/** 第二層：生教組蓋章（完成後當日解除下課管制） */
export const officeStampCard = onCall(OPTS, async (request) => {
  const caller = requireRole(request, ROLES.DISCIPLINE_STAFF);
  try {
    return await reviewReflectionCard(
      db(),
      {
        cardId: request.data?.cardId,
        stage: APPROVAL_STAGES.DISCIPLINE_OFFICE,
        decision: request.data?.decision ?? 'SIGNED',
        comment: request.data?.comment,
        actor: { uid: caller.uid, name: caller.name, roles: caller.roles },
      },
      systemClock,
    );
  } catch (error) {
    throw toHttpsError(error);
  }
});

/* -------------------------- 3. 安全觀察員與檢討書 ------------------------- */

/** 值勤報到 / 離開（學務處值勤台） */
export const logObserverPeriod = onCall(OPTS, async (request) => {
  const caller = requireRole(request, ROLES.DISCIPLINE_STAFF);
  try {
    return await logPeriod(
      db(),
      {
        assignmentId: request.data?.assignmentId,
        periodNo: Number(request.data?.periodNo),
        action: request.data?.action,
        observedCount: request.data?.observedCount,
        note: request.data?.note,
        actor: { uid: caller.uid, name: caller.name },
      },
      systemClock,
    );
  } catch (error) {
    throw toHttpsError(error);
  }
});

/** 值勤改期 */
export const rescheduleObserverDuty = onCall(OPTS, async (request) => {
  const caller = requireRole(request, ROLES.DISCIPLINE_STAFF);
  try {
    await rescheduleDuty(
      db(),
      {
        assignmentId: request.data?.assignmentId,
        dutyOn: request.data?.dutyOn,
        reason: request.data?.reason ?? '生教組調整',
        actor: { uid: caller.uid, name: caller.name },
      },
      systemClock,
    );
    return { ok: true };
  } catch (error) {
    throw toHttpsError(error);
  }
});

/** 學生提交行為檢討書 */
export const submitReview = onCall(OPTS, async (request) => {
  const caller = requireRole(request, ROLES.STUDENT);
  try {
    return await submitConductReview(
      db(),
      {
        reviewId: request.data?.reviewId,
        answers: request.data?.answers ?? {},
        actor: { uid: caller.uid, name: caller.name, roles: caller.roles },
      },
      systemClock,
    );
  } catch (error) {
    throw toHttpsError(error);
  }
});

/** 檢討書：導師簽章 */
export const teacherSignReview = onCall(OPTS, async (request) => {
  const caller = requireRole(request, ROLES.HOMEROOM_TEACHER);
  try {
    return await reviewConductReview(
      db(),
      {
        reviewId: request.data?.reviewId,
        stage: APPROVAL_STAGES.HOMEROOM_TEACHER,
        decision: request.data?.decision ?? 'SIGNED',
        comment: request.data?.comment,
        actor: { uid: caller.uid, name: caller.name, roles: caller.roles },
      },
      systemClock,
    );
  } catch (error) {
    throw toHttpsError(error);
  }
});

/** 檢討書：生教組蓋章（通過後隔日解鎖） */
export const officeStampReview = onCall(OPTS, async (request) => {
  const caller = requireRole(request, ROLES.DISCIPLINE_STAFF);
  try {
    return await reviewConductReview(
      db(),
      {
        reviewId: request.data?.reviewId,
        stage: APPROVAL_STAGES.DISCIPLINE_OFFICE,
        decision: request.data?.decision ?? 'SIGNED',
        comment: request.data?.comment,
        actor: { uid: caller.uid, name: caller.name, roles: caller.roles },
      },
      systemClock,
    );
  } catch (error) {
    throw toHttpsError(error);
  }
});

/** 撤銷誤判之累犯警示 */
export const dismissRecidivismAlert = onCall(OPTS, async (request) => {
  const caller = requireRole(request, ROLES.DISCIPLINE_STAFF);
  try {
    await dismissAlert(
      db(),
      {
        alertId: request.data?.alertId,
        reason: request.data?.reason ?? '生教組審酌後撤銷',
        actor: { uid: caller.uid, name: caller.name },
      },
      systemClock,
    );
    return { ok: true };
  } catch (error) {
    throw toHttpsError(error);
  }
});

/* ------------------------------ 4. 查詢端點 ------------------------------ */

/** 生教組戰情儀表板：今日管制名單 + 追蹤清單 */
export const officeDashboard = onCall(OPTS, async (request) => {
  requireRole(request, ROLES.DISCIPLINE_STAFF, ROLES.HOMEROOM_TEACHER);
  try {
    const firestore = db();
    const today = systemClock.today();
    const [restrictions, tracking] = await Promise.all([
      listRestrictionsOn(firestore, today),
      listTrackingList(firestore, {}),
    ]);
    return {
      today,
      restrictedCount: restrictions.filter((r) => r.status === 'ACTIVE').length,
      restrictions,
      tracking,
    };
  } catch (error) {
    throw toHttpsError(error);
  }
});

/** 單一學生的累犯進度（只讀，不觸發處分） */
export const studentRecidivismProgress = onCall(OPTS, async (request) => {
  const caller = requireAuth(request);
  const studentId = request.data?.studentId ?? caller.studentId;
  if (!studentId) throw toHttpsError(new Error('缺少 studentId'));
  try {
    return await peekProgress(db(), {
      studentId,
      asOf: request.data?.asOf ?? systemClock.today(),
    });
  } catch (error) {
    throw toHttpsError(error);
  }
});
