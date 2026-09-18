import { describe, expect, it } from 'vitest';
import {
  buildAlert,
  evaluateRecidivism,
  summarizeProgress,
  type CountableInfraction,
  type RecidivismConfig,
} from '../src/domain/recidivism.js';
import { INFRACTION_STATUS, type SchoolDate } from '../src/domain/types.js';

const CONFIG: RecidivismConfig = { windowDays: 15, threshold: 3 };
const ASOF: SchoolDate = '2026-09-18';

function rec(
  overrides: Partial<CountableInfraction> & { id: string; occurredOn: SchoolDate },
): CountableInfraction {
  return {
    studentId: 'stu_001',
    typeName: '走廊奔跑',
    status: INFRACTION_STATUS.OPEN,
    countsTowardRecidivism: true,
    consumedByAlertId: null,
    ...overrides,
  };
}

describe('再犯偵測：15 天內 3 次觸發', () => {
  it('2 次未達門檻，回報還差 1 次', () => {
    const result = evaluateRecidivism({
      studentId: 'stu_001',
      asOf: ASOF,
      infractions: [rec({ id: 'i1', occurredOn: '2026-09-10' }), rec({ id: 'i2', occurredOn: '2026-09-15' })],
      config: CONFIG,
    });
    expect(result.triggered).toBe(false);
    expect(result.count).toBe(2);
    expect(result.shortfall).toBe(1);
  });

  it('第 3 次登錄即觸發，並回傳視窗與認列明細', () => {
    const result = evaluateRecidivism({
      studentId: 'stu_001',
      asOf: ASOF,
      infractions: [
        rec({ id: 'i1', occurredOn: '2026-09-10' }),
        rec({ id: 'i2', occurredOn: '2026-09-15' }),
        rec({ id: 'i3', occurredOn: '2026-09-18' }),
      ],
      config: CONFIG,
    });
    expect(result.triggered).toBe(true);
    expect(result.count).toBe(3);
    expect(result.shortfall).toBe(0);
    expect(result.windowStart).toBe('2026-09-04');
    expect(result.windowEnd).toBe('2026-09-18');
    expect(result.counted.map((c) => c.id)).toEqual(['i1', 'i2', 'i3']);
  });

  it('走廊奔跑與口出穢言合併計算（不論類型）', () => {
    const result = evaluateRecidivism({
      studentId: 'stu_001',
      asOf: ASOF,
      infractions: [
        rec({ id: 'i1', occurredOn: '2026-09-08', typeName: '走廊奔跑' }),
        rec({ id: 'i2', occurredOn: '2026-09-12', typeName: '口出穢言' }),
        rec({ id: 'i3', occurredOn: '2026-09-18', typeName: '走廊奔跑' }),
      ],
      config: CONFIG,
    });
    expect(result.triggered).toBe(true);
  });

  it('紙本是否回收不影響次數（OPEN 與 DONE 都計入）', () => {
    const result = evaluateRecidivism({
      studentId: 'stu_001',
      asOf: ASOF,
      infractions: [
        rec({ id: 'i1', occurredOn: '2026-09-10', status: INFRACTION_STATUS.DONE }),
        rec({ id: 'i2', occurredOn: '2026-09-15', status: INFRACTION_STATUS.DONE }),
        rec({ id: 'i3', occurredOn: '2026-09-18', status: INFRACTION_STATUS.OPEN }),
      ],
      config: CONFIG,
    });
    expect(result.triggered).toBe(true);
    expect(result.count).toBe(3);
  });

  it('第 15 天（邊界）計入；第 16 天前的紀錄排除', () => {
    const inWindow = evaluateRecidivism({
      studentId: 'stu_001',
      asOf: ASOF,
      infractions: [
        rec({ id: 'i1', occurredOn: '2026-09-04' }), // 視窗第 1 天
        rec({ id: 'i2', occurredOn: '2026-09-11' }),
        rec({ id: 'i3', occurredOn: '2026-09-18' }),
      ],
      config: CONFIG,
    });
    expect(inWindow.triggered).toBe(true);

    const outOfWindow = evaluateRecidivism({
      studentId: 'stu_001',
      asOf: ASOF,
      infractions: [
        rec({ id: 'i1', occurredOn: '2026-09-03' }), // 超出視窗
        rec({ id: 'i2', occurredOn: '2026-09-11' }),
        rec({ id: 'i3', occurredOn: '2026-09-18' }),
      ],
      config: CONFIG,
    });
    expect(outOfWindow.triggered).toBe(false);
    expect(outOfWindow.count).toBe(2);
  });

  it('免記（班級活動優先）不計入', () => {
    const result = evaluateRecidivism({
      studentId: 'stu_001',
      asOf: ASOF,
      infractions: [
        rec({ id: 'i1', occurredOn: '2026-09-10' }),
        rec({
          id: 'i2',
          occurredOn: '2026-09-12',
          status: INFRACTION_STATUS.EXEMPTED,
          countsTowardRecidivism: false,
        }),
        rec({ id: 'i3', occurredOn: '2026-09-18' }),
      ],
      config: CONFIG,
    });
    expect(result.count).toBe(2);
    expect(result.triggered).toBe(false);
  });

  it('撤銷（誤報）不計入', () => {
    const result = evaluateRecidivism({
      studentId: 'stu_001',
      asOf: ASOF,
      infractions: [
        rec({ id: 'i1', occurredOn: '2026-09-10' }),
        rec({
          id: 'i2',
          occurredOn: '2026-09-12',
          status: INFRACTION_STATUS.VOIDED,
          countsTowardRecidivism: false,
        }),
        rec({ id: 'i3', occurredOn: '2026-09-18' }),
      ],
      config: CONFIG,
    });
    expect(result.count).toBe(2);
  });

  it('已被前次警示認列的紀錄不再重複觸發（幂等）', () => {
    const infractions = [
      rec({ id: 'i1', occurredOn: '2026-09-10', consumedByAlertId: 'alert_1' }),
      rec({ id: 'i2', occurredOn: '2026-09-12', consumedByAlertId: 'alert_1' }),
      rec({ id: 'i3', occurredOn: '2026-09-15', consumedByAlertId: 'alert_1' }),
      rec({ id: 'i4', occurredOn: '2026-09-18' }), // 第 4 次
    ];
    const result = evaluateRecidivism({ studentId: 'stu_001', asOf: ASOF, infractions, config: CONFIG });
    expect(result.triggered).toBe(false);
    expect(result.count).toBe(1);
  });

  it('只計算指定學生，不受同班同學紀錄干擾', () => {
    const result = evaluateRecidivism({
      studentId: 'stu_001',
      asOf: ASOF,
      infractions: [
        rec({ id: 'i1', occurredOn: '2026-09-10' }),
        rec({ id: 'x1', occurredOn: '2026-09-11', studentId: 'stu_002' }),
        rec({ id: 'x2', occurredOn: '2026-09-12', studentId: 'stu_002' }),
      ],
      config: CONFIG,
    });
    expect(result.count).toBe(1);
  });

  it('重複傳入同一筆只算一次', () => {
    const duplicated = rec({ id: 'i1', occurredOn: '2026-09-10' });
    const result = evaluateRecidivism({
      studentId: 'stu_001',
      asOf: ASOF,
      infractions: [duplicated, { ...duplicated }, rec({ id: 'i2', occurredOn: '2026-09-11' })],
      config: CONFIG,
    });
    expect(result.count).toBe(2);
  });

  it('可調參數：門檻 2 次 / 視窗 7 天', () => {
    const result = evaluateRecidivism({
      studentId: 'stu_001',
      asOf: ASOF,
      infractions: [rec({ id: 'i1', occurredOn: '2026-09-12' }), rec({ id: 'i2', occurredOn: '2026-09-18' })],
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

  it('組出警示文件並認列全部違規', () => {
    const evaluation = evaluateRecidivism({
      studentId: 'stu_001',
      asOf: ASOF,
      infractions: [
        rec({ id: 'i1', occurredOn: '2026-09-10' }),
        rec({ id: 'i2', occurredOn: '2026-09-15' }),
        rec({ id: 'i3', occurredOn: '2026-09-18' }),
      ],
      config: CONFIG,
    });
    const alert = buildAlert({
      evaluation,
      triggerInfractionId: 'i3',
      student,
      now: '2026-09-18T04:00:00.000Z',
    });
    expect(alert.status).toBe('OPEN');
    expect(alert.infractionIds).toEqual(['i1', 'i2', 'i3']);
    expect(alert.count).toBe(3);
    expect(alert.threshold).toBe(3);
    expect(alert.windowDays).toBe(15);
    expect(alert.breakdown).toHaveLength(3);
    expect(alert.studentName).toBe('王小明');
  });

  it('未觸發時拒絕建立警示', () => {
    const evaluation = evaluateRecidivism({
      studentId: 'stu_001',
      asOf: ASOF,
      infractions: [rec({ id: 'i1', occurredOn: '2026-09-10' })],
      config: CONFIG,
    });
    expect(() =>
      buildAlert({ evaluation, triggerInfractionId: 'i1', student, now: '2026-09-18T04:00:00.000Z' }),
    ).toThrow();
  });
});

describe('summarizeProgress（關注名單）', () => {
  it('依次數排序並標記僅差 1 次者', () => {
    const rows = summarizeProgress({
      asOf: ASOF,
      infractions: [
        rec({ id: 'a1', occurredOn: '2026-09-10', studentId: 'stu_001' }),
        rec({ id: 'a2', occurredOn: '2026-09-12', studentId: 'stu_001' }),
        rec({ id: 'b1', occurredOn: '2026-09-12', studentId: 'stu_002' }),
      ],
      config: CONFIG,
    });
    expect(rows[0]).toEqual({ studentId: 'stu_001', count: 2, shortfall: 1, atRisk: true });
    expect(rows[1]).toEqual({ studentId: 'stu_002', count: 1, shortfall: 2, atRisk: false });
  });
});
