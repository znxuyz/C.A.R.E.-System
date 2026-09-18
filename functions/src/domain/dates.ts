/**
 * 校務日期運算（Asia/Taipei）
 *
 * 全系統的「天數」一律以校務日期字串 `YYYY-MM-DD` 運算，理由：
 *  1. 累犯視窗是「日」的概念，不應受 UTC 位移影響
 *     （台北 2026-09-18 08:00 在 UTC 仍是 09-18，但 08:00 前的事件會跨日）。
 *  2. `YYYY-MM-DD` 字典序 = 時間序，可直接用於 Firestore 範圍查詢與比較。
 */

import type { SchoolDate } from './types.js';

export const TAIPEI_TZ = 'Asia/Taipei';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 將時間點轉為指定時區的校務日期 `YYYY-MM-DD` */
export function toSchoolDate(at: Date | string, timeZone: string = TAIPEI_TZ): SchoolDate {
  const d = typeof at === 'string' ? new Date(at) : at;
  if (Number.isNaN(d.getTime())) throw new RangeError(`無效的時間值：${String(at)}`);
  // en-CA 的短日期格式即為 YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** 取得該時區的「今天」 */
export function todayInTaipei(now: Date = new Date()): SchoolDate {
  return toSchoolDate(now, TAIPEI_TZ);
}

export function assertSchoolDate(date: string): SchoolDate {
  if (!DATE_RE.test(date)) throw new RangeError(`校務日期格式須為 YYYY-MM-DD，收到：${date}`);
  return date;
}

function toUtcMillis(date: SchoolDate): number {
  assertSchoolDate(date);
  const parts = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(parts[0], parts[1] - 1, parts[2]);
}

function fromUtcMillis(ms: number): SchoolDate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** 日期加減（可為負數） */
export function addDays(date: SchoolDate, days: number): SchoolDate {
  return fromUtcMillis(toUtcMillis(date) + days * 86_400_000);
}

/** a - b 的天數差 */
export function diffDays(a: SchoolDate, b: SchoolDate): number {
  return Math.round((toUtcMillis(a) - toUtcMillis(b)) / 86_400_000);
}

/** 0 = 週日 … 6 = 週六 */
export function dayOfWeek(date: SchoolDate): number {
  return new Date(toUtcMillis(date)).getUTCDay();
}

export function isWeekend(date: SchoolDate): boolean {
  const dow = dayOfWeek(date);
  return dow === 0 || dow === 6;
}

/**
 * 計算回溯視窗 [start, end]。
 * 規格：「往前檢索 15 天內（含當天）」→ 視窗長度 15 天，
 * 故 start = end - 14 天，兩端皆含。
 */
export function recidivismWindow(
  asOf: SchoolDate,
  windowDays: number,
): { windowStart: SchoolDate; windowEnd: SchoolDate } {
  if (!Number.isInteger(windowDays) || windowDays < 1) {
    throw new RangeError(`windowDays 須為正整數，收到：${windowDays}`);
  }
  return { windowStart: addDays(asOf, -(windowDays - 1)), windowEnd: assertSchoolDate(asOf) };
}

/** 判斷日期是否落在視窗內（含兩端）；ISO 日期可直接字串比較 */
export function isWithinWindow(
  date: SchoolDate,
  windowStart: SchoolDate,
  windowEnd: SchoolDate,
): boolean {
  return date >= windowStart && date <= windowEnd;
}

/**
 * 校曆：預設週一至週五為上課日，
 * 另可用 `overrides` 註記國定假日（false）或補課日（true）。
 * 對應 Firestore `schoolCalendar/{YYYY-MM-DD}` 集合。
 */
export interface SchoolCalendar {
  isSchoolDay(date: SchoolDate): boolean;
}

export function createSchoolCalendar(
  overrides: Record<SchoolDate, boolean> = {},
): SchoolCalendar {
  return {
    isSchoolDay(date: SchoolDate): boolean {
      const override = overrides[assertSchoolDate(date)];
      if (typeof override === 'boolean') return override;
      return !isWeekend(date);
    },
  };
}

/**
 * 下一個上課日（用於安全觀察員檢討書通過後「隔日解鎖」）。
 * 若隔日為假日則順延至下一個上課日，最多向後找 30 天以防校曆設定錯誤造成無限迴圈。
 */
export function nextSchoolDay(
  date: SchoolDate,
  calendar: SchoolCalendar = createSchoolCalendar(),
  maxLookaheadDays = 30,
): SchoolDate {
  let cursor = addDays(date, 1);
  for (let i = 0; i < maxLookaheadDays; i += 1) {
    if (calendar.isSchoolDay(cursor)) return cursor;
    cursor = addDays(cursor, 1);
  }
  throw new Error(`自 ${date} 起 ${maxLookaheadDays} 天內找不到上課日，請檢查校曆設定`);
}

/** 產生 [from, to] 間的所有日期（含兩端） */
export function eachDay(from: SchoolDate, to: SchoolDate): SchoolDate[] {
  const days: SchoolDate[] = [];
  for (let cursor = assertSchoolDate(from); cursor <= to; cursor = addDays(cursor, 1)) {
    days.push(cursor);
  }
  return days;
}
