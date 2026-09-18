/**
 * Callable Functions（前端唯一寫入管道）
 *
 * 安全規則禁止 client 直接寫入業務集合，所有狀態變更都必須經由這些 callable，
 * 以保證：伺服器時戳、再犯偵測在交易中執行、稽核軌跡完整、
 * 以及公開看板的去識別化摘要同步更新。
 */
import { onCall } from 'firebase-functions/v2/https';
import { db } from '../lib/firebase.js';
import { systemClock } from '../lib/clock.js';
import {
  annotateInfraction,
  listPendingPapers,
  logInfraction,
  markPaperReturned,
} from '../services/infractionService.js';
import {
  dismissAlert,
  listTrackingList,
  logPeriod,
  markReviewReturned,
  rescheduleDuty,
} from '../services/observerService.js';
import { listRestrictionsOn } from '../services/restrictionService.js';
import { peekProgress } from '../services/recidivismService.js';
import { rebuildPublicBoard } from '../services/publicBoardService.js';
import { requireStaff, toHttpsError } from './auth.js';

const OPTS = { region: 'asia-east1' as const, cors: true };

/** 每次狀態變更後同步更新公開看板（失敗不影響主要操作） */
async function refreshBoard(): Promise<void> {
  try {
    await rebuildPublicBoard(db(), systemClock);
  } catch {
    /* 看板為次要資訊，重建失敗由每日排程補救 */
  }
}

/* --------------------------- 1. 違規登錄 --------------------------- */

export const createInfraction = onCall(OPTS, async (request) => {
  const caller = requireStaff(request);
  try {
    const result = await logInfraction(
      db(),
      {
        studentNo: request.data?.studentNo,
        studentId: request.data?.studentId,
        typeCode: request.data?.typeCode,
        occurredAt: request.data?.occurredAt,
        periodNo: request.data?.periodNo,
        locationCode: request.data?.locationCode,
        note: request.data?.note,
        actor: { uid: caller.uid, name: caller.name },
      },
      systemClock,
    );
    await refreshBoard();
    return result;
  } catch (error) {
    throw toHttpsError(error);
  }
});

/* ----------------------- 2. 紙本回收與註記 ------------------------ */

/** 紙本反思卡回收 → 當日解除下課管制 */
export const returnPaperCard = onCall(OPTS, async (request) => {
  const caller = requireStaff(request);
  try {
    const result = await markPaperReturned(
      db(),
      { infractionId: request.data?.infractionId, actor: { uid: caller.uid, name: caller.name } },
      systemClock,
    );
    await refreshBoard();
    return result;
  } catch (error) {
    throw toHttpsError(error);
  }
});

/** 免記（班級活動優先等）或撤銷（誤報） */
export const annotateCase = onCall(OPTS, async (request) => {
  const caller = requireStaff(request);
  try {
    await annotateInfraction(
      db(),
      {
        infractionId: request.data?.infractionId,
        action: request.data?.action === 'VOID' ? 'VOID' : 'EXEMPT',
        reason: String(request.data?.reason ?? ''),
        actor: { uid: caller.uid, name: caller.name },
      },
      systemClock,
    );
    await refreshBoard();
    return { ok: true };
  } catch (error) {
    throw toHttpsError(error);
  }
});

/* --------------------------- 3. 安全觀察員 --------------------------- */

export const logObserverPeriod = onCall(OPTS, async (request) => {
  const caller = requireStaff(request);
  try {
    const result = await logPeriod(
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
    await refreshBoard();
    return result;
  } catch (error) {
    throw toHttpsError(error);
  }
});

/** 紙本行為檢討書回收 → 隔日解鎖 */
export const returnConductReview = onCall(OPTS, async (request) => {
  const caller = requireStaff(request);
  try {
    const result = await markReviewReturned(
      db(),
      { assignmentId: request.data?.assignmentId, actor: { uid: caller.uid, name: caller.name } },
      systemClock,
    );
    await refreshBoard();
    return result;
  } catch (error) {
    throw toHttpsError(error);
  }
});

export const rescheduleObserverDuty = onCall(OPTS, async (request) => {
  const caller = requireStaff(request);
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
    await refreshBoard();
    return { ok: true };
  } catch (error) {
    throw toHttpsError(error);
  }
});

export const dismissRecidivismAlert = onCall(OPTS, async (request) => {
  const caller = requireStaff(request);
  try {
    await dismissAlert(
      db(),
      {
        alertId: request.data?.alertId,
        reason: String(request.data?.reason ?? ''),
        actor: { uid: caller.uid, name: caller.name },
      },
      systemClock,
    );
    await refreshBoard();
    return { ok: true };
  } catch (error) {
    throw toHttpsError(error);
  }
});

/* ------------------------------ 4. 查詢 ------------------------------ */

export const dashboard = onCall(OPTS, async (request) => {
  requireStaff(request);
  try {
    const firestore = db();
    const today = systemClock.today();
    const [restrictions, pendingPapers, tracking] = await Promise.all([
      listRestrictionsOn(firestore, today),
      listPendingPapers(firestore),
      listTrackingList(firestore, {}),
    ]);
    return {
      today,
      restrictedCount: restrictions.filter((r) => r.status === 'ACTIVE').length,
      restrictions,
      pendingPapers,
      tracking,
    };
  } catch (error) {
    throw toHttpsError(error);
  }
});

/** 單一學生的再犯進度（只讀，不觸發處分） */
export const studentProgress = onCall(OPTS, async (request) => {
  requireStaff(request);
  try {
    return await peekProgress(db(), {
      studentId: String(request.data?.studentId ?? ''),
      asOf: request.data?.asOf ?? systemClock.today(),
    });
  } catch (error) {
    throw toHttpsError(error);
  }
});
