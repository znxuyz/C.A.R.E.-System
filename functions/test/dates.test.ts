import { describe, expect, it } from 'vitest';
import {
  addDays,
  createSchoolCalendar,
  diffDays,
  eachDay,
  isWithinWindow,
  nextSchoolDay,
  recidivismWindow,
  toSchoolDate,
} from '../src/domain/dates.js';

describe('校務日期（Asia/Taipei）', () => {
  it('UTC 深夜時點應歸屬台北的隔日', () => {
    // 2026-09-17T16:30:00Z = 台北 2026-09-18 00:30
    expect(toSchoolDate('2026-09-17T16:30:00Z')).toBe('2026-09-18');
    // 2026-09-17T15:59:00Z = 台北 2026-09-17 23:59
    expect(toSchoolDate('2026-09-17T15:59:00Z')).toBe('2026-09-17');
  });

  it('跨月與閏年加減正確', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(diffDays('2026-09-18', '2026-09-04')).toBe(14);
  });
});

describe('15 天累犯視窗', () => {
  it('含當天共 15 天，故起日為當天往前 14 天', () => {
    const { windowStart, windowEnd } = recidivismWindow('2026-09-18', 15);
    expect(windowStart).toBe('2026-09-04');
    expect(windowEnd).toBe('2026-09-18');
    expect(diffDays(windowEnd, windowStart) + 1).toBe(15);
  });

  it('邊界日含入、第 16 天排除', () => {
    const { windowStart, windowEnd } = recidivismWindow('2026-09-18', 15);
    expect(isWithinWindow('2026-09-04', windowStart, windowEnd)).toBe(true);
    expect(isWithinWindow('2026-09-03', windowStart, windowEnd)).toBe(false);
    expect(isWithinWindow('2026-09-18', windowStart, windowEnd)).toBe(true);
    expect(isWithinWindow('2026-09-19', windowStart, windowEnd)).toBe(false);
  });

  it('視窗天數須為正整數', () => {
    expect(() => recidivismWindow('2026-09-18', 0)).toThrow();
  });
});

describe('隔日解鎖（下一個上課日）', () => {
  it('平日 → 次日', () => {
    // 2026-09-18 為週五
    expect(nextSchoolDay('2026-09-17')).toBe('2026-09-18');
  });

  it('週五 → 跳過週末至週一', () => {
    expect(nextSchoolDay('2026-09-18')).toBe('2026-09-21');
  });

  it('遇國定假日順延，補課日視為上課日', () => {
    const calendar = createSchoolCalendar({
      '2026-09-21': false, // 假日
      '2026-09-22': false, // 假日
      '2026-09-26': true, // 補課（週六）
    });
    expect(nextSchoolDay('2026-09-18', calendar)).toBe('2026-09-23');
    expect(nextSchoolDay('2026-09-25', calendar)).toBe('2026-09-26');
  });
});

describe('eachDay', () => {
  it('產生含兩端的日期清單', () => {
    expect(eachDay('2026-09-16', '2026-09-18')).toEqual([
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
    ]);
  });
});
