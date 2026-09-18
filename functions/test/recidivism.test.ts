import { describe, expect, it } from 'vitest';
import {
  buildAlert,
  evaluateRecidivism,
  summarizeProgress,
  type CountableCard,
  type RecidivismConfig,
} from '../src/domain/recidivism.js';
import { CASE_STATUS, FORM_KINDS, type SchoolDate } from '../src/domain/types.js';

const CONFIG: RecidivismConfig = { windowDays: 15, threshold: 3 };
const ASOF: SchoolDate = '2026-09-18';

function card(overrides: Partial<CountableCard> & { id: string; countOn: SchoolDate }): CountableCard {
  return {
    studentId: 'stu_001',
    formKind: FORM_KINDS.SAFETY_REFLECTION,
    status: CASE_STATUS.PENDING_TEACHER,
    countsTowardRecidivism: true,
    consumedByAlertId: null,
    ...overrides,
  };
}

describe('累犯偵測：15 天內 3 張觸發', () => {
  it('2 張未達門檻，回報還差 1 張', () => {
    const result = evaluateRecidivism({
      studentId: 'stu_001',
      asOf: ASOF,
      cards: [card({ id: 'c1', countOn: '2026-09-10' }), card({ id: 'c2', countOn: '2026-09-15' })],
      config: CONFIG,
    });
    expect(result.triggered).toBe(false);
    expect(result.cardCount).toBe(2);
    expect(result.shortfall).toBe(1);
  });

  it('第 3 張送出即觸發，並回傳視窗與認列卡片', () => {
    const result = evaluateRecidivism({
      studentId: 'stu_001',
      asOf: ASOF,
      cards: [
        card({ id: 'c1', countOn: '2026-09-10' }),
        card({ id: 'c2', countOn: '2026-09-15' }),
        card({ id: 'c3', countOn: '2026-09-18' }),
      ],
      config: CONFIG,
    });
    expect(result.triggered).toBe(true);
    expect(result.cardCount).toBe(3);
    expect(result.shortfall).toBe(0);
    expect(result.windowStart).toBe('2026-09-04');
    expect(result.windowEnd).toBe('2026-09-18');
    expect(result.countedCards.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('安全卡與好話卡合併計算（不論卡種）', () => {
    const result = evaluateRecidivism({
      studentId: 'stu_001',
      asOf: ASOF,
      cards: [
        card({ id: 'c1', countOn: '2026-09-08', formKind: FORM_KINDS.SAFETY_REFLECTION }),
        card({ id: 'c2', countOn: '2026-09-12', formKind: FORM_KINDS.KIND_WORDS_REFLECTION }),
        card({ id: 'c3', countOn: '2026-09-18', formKind: FORM_KINDS.SAFETY_REFLECTION }),
      ],
      config: CONFIG,
    });
    expect(result.triggered).toBe(true);
  });

  it('第 15 天（邊界）計入；第 16 天前的卡片排除', () => {
    const inWindow = evaluateRecidivism({
      studentId: 'stu_001',
      asOf: ASOF,
      cards: [
        card({ id: 'c1', countOn: '2026-09-04' }), // 視窗第 1 天
        card({ id: 'c2', countOn: '2026-09-11' }),
        card({ id: 'c3', countOn: '2026-09-18' }),
      ],
      config: CONFIG,
    });
    expect(inWindow.triggered).toBe(true);

    const outOfWindow = evaluateRecidivism({
      studentId: 'stu_001',
      asOf: ASOF,
      cards: [
        card({ id: 'c1', countOn: '2026-09-03' }), // 超出視窗
        card({ id: 'c2', countOn: '2026-09-11' }),
        card({ id: 'c3', countOn: '2026-09-18' }),
      ],
      config: CONFIG,
    });
    expect(outOfWindow.triggered).toBe(false);
    expect(outOfWindow.cardCount).toBe(2);
  });

  it('草稿與退回中的卡片不計入「填寫紀錄」', () => {
    const result = evaluateRecidivism({
      studentId: 'stu_001',
      asOf: ASOF,
      cards: [
        card({ id: 'c1', countOn: '2026-09-10', status: CASE_STATUS.DRAFT }),
        card({ id: 'c2', countOn: '2026-09-12', status: CASE_STATUS.RETURNED }),
        card({ id: 'c3', countOn: '2026-09-18', status: CASE_STATUS.PENDING_TEACHER }),
      ],
      config: CONFIG,
    });
    expect(result.cardCount).toBe(1);
    expect(result.triggered).toBe(false);
  });

  it('導師勾選班級活動優先（豁免）之卡片不計入', () => {
    const result = evaluateRecidivism({
      studentId: 'stu_001',
      asOf: ASOF,
      cards: [
        card({ id: 'c1', countOn: '2026-09-10' }),
        card({
          id: 'c2',
          countOn: '2026-09-12',
          status: CASE_STATUS.EXEMPTED,
          countsTowardRecidivism: false,
        }),
        card({ id: 'c3', countOn: '2026-09-18' }),
      ],
      config: CONFIG,
    });
    expect(result.cardCount).toBe(2);
    expect(result.triggered).toBe(false);
  });

  it('已被前次警示認列的卡片不再重複觸發（幂等）', () => {
    const cards = [
      card({ id: 'c1', countOn: '2026-09-10', consumedByAlertId: 'alert_1' }),
      card({ id: 'c2', countOn: '2026-09-12', consumedByAlertId: 'alert_1' }),
      card({ id: 'c3', countOn: '2026-09-15', consumedByAlertId: 'alert_1' }),
      card({ id: 'c4', countOn: '2026-09-18' }), // 第 4 張
    ];
    const result = evaluateRecidivism({ studentId: 'stu_001', asOf: ASOF, cards, config: CONFIG });
    expect(result.triggered).toBe(false);
    expect(result.cardCount).toBe(1);
  });

  it('只計算指定學生，不受同班同學卡片干擾', () => {
    const result = evaluateRecidivism({
      studentId: 'stu_001',
      asOf: ASOF,
      cards: [
        card({ id: 'c1', countOn: '2026-09-10' }),
        card({ id: 'x1', countOn: '2026-09-11', studentId: 'stu_002' }),
        card({ id: 'x2', countOn: '2026-09-12', studentId: 'stu_002' }),
      ],
      config: CONFIG,
    });
    expect(result.cardCount).toBe(1);
  });

  it('重複傳入同一張卡片只算一次', () => {
    const duplicated = card({ id: 'c1', countOn: '2026-09-10' });
    const result = evaluateRecidivism({
      studentId: 'stu_001',
      asOf: ASOF,
      cards: [duplicated, { ...duplicated }, card({ id: 'c2', countOn: '2026-09-11' })],
      config: CONFIG,
    });
    expect(result.cardCount).toBe(2);
  });

  it('可調參數：門檻 2 張 / 視窗 7 天', () => {
    const result = evaluateRecidivism({
      studentId: 'stu_001',
      asOf: ASOF,
      cards: [card({ id: 'c1', countOn: '2026-09-12' }), card({ id: 'c2', countOn: '2026-09-18' })],
      config: { windowDays: 7, threshold: 2 },
    });
    expect(result.triggered).toBe(true);
    expect(result.windowStart).toBe('2026-09-12');
  });
});

describe('buildAlert', () => {
  const student = {
    id: 'stu_001',
    studentNo: '114001',
    name: '王小明',
    classId: 'cls_701',
    className: '七年一班',
  };

  it('組出警示文件並認列全部卡片', () => {
    const evaluation = evaluateRecidivism({
      studentId: 'stu_001',
      asOf: ASOF,
      cards: [
        card({ id: 'c1', countOn: '2026-09-10' }),
        card({ id: 'c2', countOn: '2026-09-15' }),
        card({ id: 'c3', countOn: '2026-09-18' }),
      ],
      config: CONFIG,
    });
    const alert = buildAlert({
      evaluation,
      triggerCardId: 'c3',
      student,
      now: '2026-09-18T04:00:00.000Z',
    });
    expect(alert.status).toBe('OPEN');
    expect(alert.cardIds).toEqual(['c1', 'c2', 'c3']);
    expect(alert.cardCount).toBe(3);
    expect(alert.threshold).toBe(3);
    expect(alert.windowDays).toBe(15);
    expect(alert.breakdown).toHaveLength(3);
    expect(alert.studentName).toBe('王小明');
  });

  it('未觸發時拒絕建立警示', () => {
    const evaluation = evaluateRecidivism({
      studentId: 'stu_001',
      asOf: ASOF,
      cards: [card({ id: 'c1', countOn: '2026-09-10' })],
      config: CONFIG,
    });
    expect(() =>
      buildAlert({ evaluation, triggerCardId: 'c1', student, now: '2026-09-18T04:00:00.000Z' }),
    ).toThrow();
  });
});

describe('summarizeProgress（關注名單）', () => {
  it('依張數排序並標記僅差 1 張者', () => {
    const rows = summarizeProgress({
      asOf: ASOF,
      cards: [
        card({ id: 'a1', countOn: '2026-09-10', studentId: 'stu_001' }),
        card({ id: 'a2', countOn: '2026-09-12', studentId: 'stu_001' }),
        card({ id: 'b1', countOn: '2026-09-12', studentId: 'stu_002' }),
      ],
      config: CONFIG,
    });
    expect(rows[0]).toEqual({ studentId: 'stu_001', cardCount: 2, shortfall: 1, atRisk: true });
    expect(rows[1]).toEqual({ studentId: 'stu_002', cardCount: 1, shortfall: 2, atRisk: false });
  });
});
