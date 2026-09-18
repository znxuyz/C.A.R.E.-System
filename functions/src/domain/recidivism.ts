/**
 * 累犯偵測核心演算法（Recidivism Detection）
 * ==========================================
 *
 * 規格：
 *   每筆違規成立時，自動往前檢索 15 天內（含當天）該生的累計反思卡填寫紀錄；
 *   若重複填寫累計達 3 張（不論安全卡或好話卡），立即發出警示並排入
 *   『安全觀察員追蹤清單』。
 *
 * 設計要點：
 *  1. **純函式**：本模組不觸碰 Firestore，輸入為卡片陣列、輸出為判定結果，
 *     可完整單元測試；I/O 由 `data/recidivismRepository.ts` 於交易中提供。
 *  2. **基準日用 `countOn`（= 違規發生日）**，而非填寫時間。
 *     學生隔天才到學務處補填，不會讓 15 天視窗漂移。
 *  3. **卡片認列（card consumption）**：觸發警示時，把本次計入的卡片
 *     全部標記 `consumedByAlertId`。已認列卡片不再參與後續視窗計數，
 *     因此第 4、5 張卡不會對同一波處分重複觸發；學生需再累積 3 張新卡才會
 *     再次觸發。此舉同時讓演算法**具幂等性**（同一張卡重複送出不會加罰）。
 *  4. **狀態門檻**：規格寫的是「填寫紀錄」，故學生送出（PENDING_TEACHER）即計入；
 *     草稿、退回、導師豁免（班級活動優先）、撤銷皆不計入。
 */

import { isWithinWindow, recidivismWindow } from './dates.js';
import {
  CASE_STATUS,
  type CaseStatus,
  type FormKind,
  type IsoTimestamp,
  type RecidivismAlert,
  type SchoolDate,
} from './types.js';

/** 計入累犯的卡片狀態：學生一旦送出即列入「填寫紀錄」 */
export const COUNTABLE_CASE_STATUSES: readonly CaseStatus[] = [
  CASE_STATUS.PENDING_TEACHER,
  CASE_STATUS.PENDING_OFFICE,
  CASE_STATUS.COMPLETED,
];

/** 累犯計數所需的最小卡片投影（Firestore 查詢只取這些欄位即可） */
export interface CountableCard {
  id: string;
  studentId: string;
  countOn: SchoolDate;
  formKind: FormKind;
  status: CaseStatus;
  countsTowardRecidivism: boolean;
  consumedByAlertId: string | null;
}

export interface RecidivismConfig {
  /** 回溯天數（含當天），預設 15 */
  windowDays: number;
  /** 觸發門檻，預設 3 */
  threshold: number;
}

export interface RecidivismEvaluation {
  studentId: string;
  /** 是否達到門檻、須發出警示 */
  triggered: boolean;
  windowDays: number;
  threshold: number;
  windowStart: SchoolDate;
  windowEnd: SchoolDate;
  /** 視窗內有效（未認列）卡片張數 */
  cardCount: number;
  /** 還差幾張達標；已觸發時為 0 */
  shortfall: number;
  /** 依 countOn 排序之計入卡片 */
  countedCards: CountableCard[];
}

/** 單張卡片是否計入指定視窗 */
export function isCountableCard(
  card: CountableCard,
  windowStart: SchoolDate,
  windowEnd: SchoolDate,
): boolean {
  return (
    card.countsTowardRecidivism &&
    card.consumedByAlertId === null &&
    COUNTABLE_CASE_STATUSES.includes(card.status) &&
    isWithinWindow(card.countOn, windowStart, windowEnd)
  );
}

/**
 * 核心判定：計算 `asOf` 當日回溯視窗內的有效卡片數並判斷是否觸發。
 *
 * @param cards 該生於視窗附近的卡片（允許含雜訊；本函式會自行過濾）
 */
export function evaluateRecidivism(input: {
  studentId: string;
  asOf: SchoolDate;
  cards: CountableCard[];
  config: RecidivismConfig;
}): RecidivismEvaluation {
  const { studentId, asOf, cards, config } = input;
  if (!Number.isInteger(config.threshold) || config.threshold < 1) {
    throw new RangeError(`threshold 須為正整數，收到：${config.threshold}`);
  }
  const { windowStart, windowEnd } = recidivismWindow(asOf, config.windowDays);

  const countedCards = cards
    .filter((card) => card.studentId === studentId)
    .filter((card) => isCountableCard(card, windowStart, windowEnd))
    // 去重：防止呼叫端傳入重複文件
    .filter((card, index, all) => all.findIndex((c) => c.id === card.id) === index)
    .sort((a, b) => (a.countOn === b.countOn ? a.id.localeCompare(b.id) : a.countOn < b.countOn ? -1 : 1));

  const cardCount = countedCards.length;
  const triggered = cardCount >= config.threshold;

  return {
    studentId,
    triggered,
    windowDays: config.windowDays,
    threshold: config.threshold,
    windowStart,
    windowEnd,
    cardCount,
    shortfall: triggered ? 0 : config.threshold - cardCount,
    countedCards,
  };
}

/**
 * 依判定結果組出累犯警示文件（不含 id，由 Firestore 產生）。
 * 觸發時「認列」視窗內所有有效卡片，故 cardIds.length === cardCount。
 */
export function buildAlert(input: {
  evaluation: RecidivismEvaluation;
  triggerCardId: string;
  student: {
    id: string;
    studentNo: string;
    name: string;
    classId: string;
    className: string;
  };
  now: IsoTimestamp;
}): Omit<RecidivismAlert, 'id'> {
  const { evaluation, triggerCardId, student, now } = input;
  if (!evaluation.triggered) {
    throw new Error('未達門檻不得建立累犯警示');
  }
  return {
    studentId: student.id,
    studentNo: student.studentNo,
    studentName: student.name,
    classId: student.classId,
    className: student.className,
    triggeredAt: now,
    windowDays: evaluation.windowDays,
    threshold: evaluation.threshold,
    windowStart: evaluation.windowStart,
    windowEnd: evaluation.windowEnd,
    cardCount: evaluation.cardCount,
    triggerCardId,
    cardIds: evaluation.countedCards.map((c) => c.id),
    breakdown: evaluation.countedCards.map((c) => ({
      cardId: c.id,
      formKind: c.formKind,
      countOn: c.countOn,
    })),
    status: 'OPEN',
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 儀表板用：不改動資料、僅回報各生目前的累計進度（含差幾張觸發），
 * 供生教組提前輔導（例如已 2 張者列為「關注名單」）。
 */
export function summarizeProgress(input: {
  asOf: SchoolDate;
  cards: CountableCard[];
  config: RecidivismConfig;
}): Array<{ studentId: string; cardCount: number; shortfall: number; atRisk: boolean }> {
  const { asOf, cards, config } = input;
  const studentIds = [...new Set(cards.map((c) => c.studentId))];
  return studentIds
    .map((studentId) => {
      const evaluation = evaluateRecidivism({ studentId, asOf, cards, config });
      return {
        studentId,
        cardCount: evaluation.cardCount,
        shortfall: evaluation.shortfall,
        /** 只差 1 張即觸發 → 提前關注 */
        atRisk: !evaluation.triggered && evaluation.shortfall <= 1,
      };
    })
    .sort((a, b) => b.cardCount - a.cardCount);
}
