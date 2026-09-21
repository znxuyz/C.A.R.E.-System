/**
 * 案件處理規則（純函式）
 *
 * 系統只紀錄紙本作業的兩個關鍵事實：
 *   ① 紙本反思卡是否回收   → 決定「當日」是否解除下課管制
 *   ② 紙本行為檢討書是否回收 → 決定「隔日（下一個上課日）」解鎖
 *
 * 沒有線上簽章、沒有多關卡審核；所有動作由生教組長一人執行。
 */

import { nextSchoolDay, type SchoolCalendar } from './dates.js';
import {
  INFRACTION_STATUS,
  type InfractionStatus,
  type SchoolDate,
} from './types.js';

export type CaseActionCode =
  | 'INVALID_STATE'
  | 'REASON_REQUIRED';

export class CaseRuleError extends Error {
  constructor(
    readonly code: CaseActionCode,
    message: string,
  ) {
    super(message);
    this.name = 'CaseRuleError';
  }
}

/** 可被標記「紙本已回收」的狀態 */
export function assertCanReturnPaper(status: InfractionStatus): void {
  if (status !== INFRACTION_STATUS.OPEN) {
    const label: Record<InfractionStatus, string> = {
      OPEN: '待回收',
      DONE: '已回收',
      EXEMPTED: '已免記',
      VOIDED: '已撤銷',
    };
    throw new CaseRuleError(
      'INVALID_STATE',
      `案件目前為「${label[status]}」，只有待回收的案件可標記回收`,
    );
  }
}

/** 可被豁免（班級活動優先）或撤銷（誤報）的狀態 */
export function assertCanAnnotate(status: InfractionStatus, reason: string): void {
  if (status === INFRACTION_STATUS.VOIDED || status === INFRACTION_STATUS.EXEMPTED) {
    throw new CaseRuleError('INVALID_STATE', '案件已結案（免記／撤銷），不可重複處理');
  }
  if (!reason.trim()) {
    throw new CaseRuleError('REASON_REQUIRED', '請填寫事由，以符合正向管教之說明義務與稽核需求');
  }
}

/**
 * 反思卡回收 → 當日解除管制。
 * 回收日即解除日（規格：「當天完成…系統於當日自動解除下課管制」）。
 */
export function unlockDateForPaperReturn(returnedOn: SchoolDate): SchoolDate {
  return returnedOn;
}

/**
 * 行為檢討書回收 → 隔日解鎖。
 * 規格：「通過後的隔日，系統才正式解鎖」；遇假日依校曆順延至下一個上課日。
 */
export function unlockDateForReviewReturn(
  returnedOn: SchoolDate,
  calendar?: SchoolCalendar,
): SchoolDate {
  return nextSchoolDay(returnedOn, calendar);
}

/** 案件是否仍需追蹤（出現在「待回收」清單） */
export function isPending(status: InfractionStatus): boolean {
  return status === INFRACTION_STATUS.OPEN;
}

export const INFRACTION_STATUS_LABEL: Record<InfractionStatus, string> = {
  OPEN: '待回收反思卡',
  DONE: '已回收・已解除',
  EXEMPTED: '免記（班級活動優先）',
  VOIDED: '已撤銷（誤報）',
};
