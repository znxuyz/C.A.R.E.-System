/**
 * C.A.R.E. System — Cloud Functions 入口
 *
 * 部署區域：asia-east1（台灣）。
 *
 * 匯出清單：
 *  違規登錄      createInfraction
 *  紙本與註記    returnPaperCard / annotateCase
 *  安全觀察員    logObserverPeriod / returnConductReview /
 *                rescheduleObserverDuty / dismissRecidivismAlert
 *  查詢          dashboard / studentProgress
 *  排程          dailyRollForward
 *  管理          setUserRoles / updateSettings
 */
import { setGlobalOptions } from 'firebase-functions/v2';

setGlobalOptions({ region: 'asia-east1', maxInstances: 10 });

export {
  createInfraction,
  returnPaperCard,
  annotateCase,
  logObserverPeriod,
  returnConductReview,
  rescheduleObserverDuty,
  dismissRecidivismAlert,
  dashboard,
  studentProgress,
} from './handlers/callables.js';

export { dailyRollForward } from './handlers/scheduled.js';
export { setUserRoles, updateSettings } from './handlers/admin.js';
