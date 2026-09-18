/**
 * 時間來源
 *
 * 全系統時間戳一律由伺服器（Cloud Functions）產生並以 ISO-8601 字串儲存：
 *  - ISO-8601（UTC）字串的字典序 = 時間序，可直接用於 Firestore 排序與範圍查詢。
 *  - 安全規則禁止 client 寫入時間欄位，避免竄改簽章時間。
 *  - 測試時可注入固定 Clock。
 */
import { todayInTaipei } from '../domain/dates.js';
import type { IsoTimestamp, SchoolDate } from '../domain/types.js';

export interface Clock {
  now(): IsoTimestamp;
  today(): SchoolDate;
}

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
  today: () => todayInTaipei(new Date()),
};

export function fixedClock(iso: IsoTimestamp): Clock {
  return { now: () => iso, today: () => todayInTaipei(new Date(iso)) };
}
