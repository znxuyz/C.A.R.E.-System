import { describe, expect, it } from 'vitest';
import {
  CaseRuleError,
  assertCanAnnotate,
  assertCanReturnPaper,
  isPending,
  unlockDateForPaperReturn,
  unlockDateForReviewReturn,
} from '../src/core/domain/caseRules.js';
import { createSchoolCalendar } from '../src/core/domain/dates.js';
import { INFRACTION_STATUS } from '../src/core/domain/types.js';

describe('紙本反思卡回收', () => {
  it('待回收的案件可標記回收', () => {
    expect(() => assertCanReturnPaper(INFRACTION_STATUS.OPEN)).not.toThrow();
  });

  it('已回收 / 已免記 / 已撤銷的案件不可重複標記', () => {
    expect(() => assertCanReturnPaper(INFRACTION_STATUS.DONE)).toThrow(CaseRuleError);
    expect(() => assertCanReturnPaper(INFRACTION_STATUS.EXEMPTED)).toThrow(/已免記/);
    expect(() => assertCanReturnPaper(INFRACTION_STATUS.VOIDED)).toThrow(/已撤銷/);
  });

  it('回收當日即解除管制', () => {
    expect(unlockDateForPaperReturn('2026-09-18')).toBe('2026-09-18');
  });
});

describe('免記 / 撤銷', () => {
  it('必須填寫事由', () => {
    expect(() => assertCanAnnotate(INFRACTION_STATUS.OPEN, '   ')).toThrow(/事由/);
    expect(() => assertCanAnnotate(INFRACTION_STATUS.OPEN, '班際球賽練習')).not.toThrow();
  });

  it('已結案的案件不可重複處理', () => {
    expect(() => assertCanAnnotate(INFRACTION_STATUS.EXEMPTED, '理由')).toThrow(/已結案/);
    expect(() => assertCanAnnotate(INFRACTION_STATUS.VOIDED, '理由')).toThrow(/已結案/);
  });

  it('已回收的案件仍可事後更正為免記或撤銷', () => {
    expect(() => assertCanAnnotate(INFRACTION_STATUS.DONE, '事後查證為誤報')).not.toThrow();
  });
});

describe('行為檢討書回收 → 隔日解鎖', () => {
  it('平日回收 → 次日解鎖', () => {
    expect(unlockDateForReviewReturn('2026-09-17')).toBe('2026-09-18');
  });

  it('週五回收 → 跳過週末至週一', () => {
    expect(unlockDateForReviewReturn('2026-09-18')).toBe('2026-09-21');
  });

  it('遇連假依校曆順延', () => {
    const calendar = createSchoolCalendar({ '2026-09-21': false, '2026-09-22': false });
    expect(unlockDateForReviewReturn('2026-09-18', calendar)).toBe('2026-09-23');
  });
});

describe('isPending', () => {
  it('只有待回收的案件需要追蹤', () => {
    expect(isPending(INFRACTION_STATUS.OPEN)).toBe(true);
    expect(isPending(INFRACTION_STATUS.DONE)).toBe(false);
    expect(isPending(INFRACTION_STATUS.EXEMPTED)).toBe(false);
  });
});
