/**
 * 再犯偵測核心演算法（Recidivism Detection）
 * ==========================================
 *
 * 規格：
 *   每筆違規成立時，自動往前檢索 15 天內（含當天）該生的累計違規紀錄；
 *   若累計達 3 次（不論走廊奔跑或口出穢言），立即發出警示並排入
 *   『安全觀察員追蹤清單』。
 *
 * 設計要點：
 *  1. **純函式**：不觸碰 Firestore，輸入為違規陣列、輸出為判定結果，
 *     可完整單元測試；I/O 由 `services/recidivismService.ts` 於交易中提供。
 *  2. **基準日用 `occurredOn`（違規發生日）**，而非登錄時間。
 *     事後補登錄不會讓 15 天視窗漂移。
 *  3. **認列（consumption）**：觸發警示時把本次計入的違規全部標記
 *     `consumedByAlertId`。已認列者不再參與後續視窗計數，因此第 4、5 次
 *     不會對同一波處分重複觸發；學生需再累積 3 次新違規才會再次觸發。
 *     此舉同時讓演算法**具幂等性**（重複評估不會加罰）。
 *  4. **狀態門檻**：違規一經登錄即成立並計入；
 *     只有「班級活動優先豁免」與「誤報撤銷」不計入。
 */

import { isWithinWindow, recidivismWindow } from './dates.js';
import {
  INFRACTION_STATUS,
  type InfractionStatus,
  type IsoTimestamp,
  type RecidivismAlert,
  type SchoolDate,
} from './types.js';

/** 計入再犯的違規狀態：登錄即成立（紙本是否回收不影響次數） */
export const COUNTABLE_STATUSES: readonly InfractionStatus[] = [
  INFRACTION_STATUS.OPEN,
  INFRACTION_STATUS.DONE,
];

/** 再犯計數所需的最小違規投影（Firestore 查詢只取這些欄位即可） */
export interface CountableInfraction {
  id: string;
  studentId: string;
  occurredOn: SchoolDate;
  typeName: string;
  status: InfractionStatus;
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
  /** 視窗內有效（未認列）違規次數 */
  count: number;
  /** 還差幾次達標；已觸發時為 0 */
  shortfall: number;
  /** 依 occurredOn 排序之計入違規 */
  counted: CountableInfraction[];
}

/** 單筆違規是否計入指定視窗 */
export function isCountable(
  infraction: CountableInfraction,
  windowStart: SchoolDate,
  windowEnd: SchoolDate,
): boolean {
  return (
    infraction.countsTowardRecidivism &&
    infraction.consumedByAlertId === null &&
    COUNTABLE_STATUSES.includes(infraction.status) &&
    isWithinWindow(infraction.occurredOn, windowStart, windowEnd)
  );
}

/**
 * 核心判定：計算 `asOf` 當日回溯視窗內的有效違規次數並判斷是否觸發。
 *
 * @param infractions 該生於視窗附近的違規（允許含雜訊；本函式會自行過濾）
 */
export function evaluateRecidivism(input: {
  studentId: string;
  asOf: SchoolDate;
  infractions: CountableInfraction[];
  config: RecidivismConfig;
}): RecidivismEvaluation {
  const { studentId, asOf, infractions, config } = input;
  if (!Number.isInteger(config.threshold) || config.threshold < 1) {
    throw new RangeError(`threshold 須為正整數，收到：${config.threshold}`);
  }
  const { windowStart, windowEnd } = recidivismWindow(asOf, config.windowDays);

  const counted = infractions
    .filter((item) => item.studentId === studentId)
    .filter((item) => isCountable(item, windowStart, windowEnd))
    // 去重：防止呼叫端傳入重複文件
    .filter((item, index, all) => all.findIndex((c) => c.id === item.id) === index)
    .sort((a, b) =>
      a.occurredOn === b.occurredOn
        ? a.id.localeCompare(b.id)
        : a.occurredOn < b.occurredOn
          ? -1
          : 1,
    );

  const count = counted.length;
  const triggered = count >= config.threshold;

  return {
    studentId,
    triggered,
    windowDays: config.windowDays,
    threshold: config.threshold,
    windowStart,
    windowEnd,
    count,
    shortfall: triggered ? 0 : config.threshold - count,
    counted,
  };
}

/**
 * 依判定結果組出再犯警示文件（不含 id，由 Firestore 產生）。
 * 觸發時「認列」視窗內所有有效違規，故 infractionIds.length === count。
 */
export function buildAlert(input: {
  evaluation: RecidivismEvaluation;
  triggerInfractionId: string;
  student: {
    id: string;
    studentNo: string;
    name: string;
    classId: string;
    className: string;
  };
  now: IsoTimestamp;
}): Omit<RecidivismAlert, 'id'> {
  const { evaluation, triggerInfractionId, student, now } = input;
  if (!evaluation.triggered) {
    throw new Error('未達門檻不得建立再犯警示');
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
    count: evaluation.count,
    triggerInfractionId,
    infractionIds: evaluation.counted.map((item) => item.id),
    breakdown: evaluation.counted.map((item) => ({
      infractionId: item.id,
      typeName: item.typeName,
      occurredOn: item.occurredOn,
    })),
    status: 'OPEN',
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 儀表板用：不改動資料、僅回報各生目前的累計進度（含差幾次觸發），
 * 供生教組提前輔導（例如已 2 次者列為「關注名單」）。
 */
export function summarizeProgress(input: {
  asOf: SchoolDate;
  infractions: CountableInfraction[];
  config: RecidivismConfig;
}): Array<{ studentId: string; count: number; shortfall: number; atRisk: boolean }> {
  const { asOf, infractions, config } = input;
  const studentIds = [...new Set(infractions.map((item) => item.studentId))];
  return studentIds
    .map((studentId) => {
      const evaluation = evaluateRecidivism({ studentId, asOf, infractions, config });
      return {
        studentId,
        count: evaluation.count,
        shortfall: evaluation.shortfall,
        /** 只差 1 次即觸發 → 提前關注 */
        atRisk: !evaluation.triggered && evaluation.shortfall <= 1,
      };
    })
    .sort((a, b) => b.count - a.count);
}
