/**
 * C.A.R.E. System — Cloud Functions 入口
 *
 * 部署區域：asia-east1（台灣），降低校內連線延遲。
 *
 * 匯出清單：
 *  違規登錄        createInfraction / revokeInfraction
 *  反思卡工作流    submitCard / teacherSignCard / officeStampCard
 *  觀察員與檢討書  logObserverPeriod / rescheduleObserverDuty /
 *                  submitReview / teacherSignReview / officeStampReview /
 *                  dismissRecidivismAlert
 *  查詢            officeDashboard / studentRecidivismProgress
 *  排程            dailyRecessRollForward / pendingApprovalReminder
 *  管理            setUserRoles / registerPushToken
 */
import { setGlobalOptions } from 'firebase-functions/v2';

setGlobalOptions({ region: 'asia-east1', maxInstances: 10 });

export {
  createInfraction,
  revokeInfraction,
  submitCard,
  teacherSignCard,
  officeStampCard,
  logObserverPeriod,
  rescheduleObserverDuty,
  submitReview,
  teacherSignReview,
  officeStampReview,
  dismissRecidivismAlert,
  officeDashboard,
  studentRecidivismProgress,
} from './handlers/callables.js';

export { dailyRecessRollForward, pendingApprovalReminder } from './handlers/scheduled.js';
export { setUserRoles, registerPushToken } from './handlers/admin.js';
