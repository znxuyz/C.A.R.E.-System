import { describe, expect, it } from 'vitest';
import { createSchoolCalendar } from '../src/domain/dates.js';
import {
  canActOnStage,
  isTerminal,
  pendingStage,
  reviewCase,
  submitCase,
  WorkflowError,
  type CaseSnapshot,
} from '../src/domain/workflow.js';
import { APPROVAL_STAGES, CASE_STATUS, ROLES } from '../src/domain/types.js';

const NOW = '2026-09-18T04:00:00.000Z';
const TODAY = '2026-09-18';

const student = { uid: 'u_stu', name: '王小明', roles: [ROLES.STUDENT] };
const teacher = { uid: 'u_tea', name: '陳導師', roles: [ROLES.HOMEROOM_TEACHER] };
const office = { uid: 'u_off', name: '林生教', roles: [ROLES.DISCIPLINE_STAFF] };
const patrol = { uid: 'u_pat', name: '糾察甲', roles: [ROLES.PATROL] };

function snapshot(overrides: Partial<CaseSnapshot> = {}): CaseSnapshot {
  return {
    kind: 'REFLECTION_CARD',
    status: CASE_STATUS.DRAFT,
    approvals: [],
    returnCount: 0,
    baseDate: TODAY,
    ...overrides,
  };
}

describe('學生送出反思卡', () => {
  it('DRAFT → PENDING_TEACHER，並通知導師、重新評估累犯', () => {
    const result = submitCase(snapshot(), student, NOW);
    expect(result.status).toBe(CASE_STATUS.PENDING_TEACHER);
    expect(result.effects).toEqual(
      expect.arrayContaining([
        { type: 'NOTIFY', templateCode: 'REFLECTION_SUBMITTED_TO_TEACHER', audience: 'HOMEROOM_TEACHER' },
        { type: 'EVALUATE_RECIDIVISM', asOf: TODAY },
      ]),
    );
  });

  it('退回後可重新送出', () => {
    const result = submitCase(snapshot({ status: CASE_STATUS.RETURNED }), student, NOW);
    expect(result.status).toBe(CASE_STATUS.PENDING_TEACHER);
  });

  it('已送出者不可重複送出', () => {
    expect(() => submitCase(snapshot({ status: CASE_STATUS.PENDING_TEACHER }), student, NOW)).toThrow(
      WorkflowError,
    );
  });

  it('非學生不可代為送出', () => {
    expect(() => submitCase(snapshot(), teacher, NOW)).toThrow(/僅學生本人/);
  });
});

describe('第一層：導師簽章', () => {
  it('PENDING_TEACHER → PENDING_OFFICE，並通知生教組', () => {
    const result = reviewCase(
      snapshot({ status: CASE_STATUS.PENDING_TEACHER }),
      { stage: APPROVAL_STAGES.HOMEROOM_TEACHER, decision: 'SIGNED', actor: teacher, today: TODAY },
      NOW,
    );
    expect(result.status).toBe(CASE_STATUS.PENDING_OFFICE);
    expect(result.teacherSignedAt).toBe(NOW);
    expect(result.approvals).toHaveLength(1);
    expect(result.effects).toEqual([
      { type: 'NOTIFY', templateCode: 'CASE_PENDING_OFFICE', audience: 'DISCIPLINE_OFFICE' },
    ]);
  });

  it('糾察隊無簽章權限', () => {
    expect(() =>
      reviewCase(
        snapshot({ status: CASE_STATUS.PENDING_TEACHER }),
        { stage: APPROVAL_STAGES.HOMEROOM_TEACHER, decision: 'SIGNED', actor: patrol, today: TODAY },
        NOW,
      ),
    ).toThrow(/無權/);
  });

  it('不可跳關：導師未簽章前生教組不得蓋章', () => {
    expect(() =>
      reviewCase(
        snapshot({ status: CASE_STATUS.PENDING_TEACHER }),
        { stage: APPROVAL_STAGES.DISCIPLINE_OFFICE, decision: 'SIGNED', actor: office, today: TODAY },
        NOW,
      ),
    ).toThrow(/不在 DISCIPLINE_OFFICE 的待辦狀態/);
  });

  it('退回必須填寫原因', () => {
    expect(() =>
      reviewCase(
        snapshot({ status: CASE_STATUS.PENDING_TEACHER }),
        { stage: APPROVAL_STAGES.HOMEROOM_TEACHER, decision: 'RETURNED', actor: teacher, today: TODAY },
        NOW,
      ),
    ).toThrow(/退回原因/);
  });

  it('退回後累計退回次數 +1', () => {
    const result = reviewCase(
      snapshot({ status: CASE_STATUS.PENDING_TEACHER, returnCount: 1 }),
      {
        stage: APPROVAL_STAGES.HOMEROOM_TEACHER,
        decision: 'RETURNED',
        actor: teacher,
        comment: '請具體描述改善作法',
        today: TODAY,
      },
      NOW,
    );
    expect(result.status).toBe(CASE_STATUS.RETURNED);
    expect(result.returnCount).toBe(2);
  });
});

describe('導師班級活動優先（豁免）', () => {
  it('勾選後結案為 EXEMPTED、不計入累犯並解除當日管制', () => {
    const result = reviewCase(
      snapshot({ status: CASE_STATUS.PENDING_TEACHER, baseDate: '2026-09-17' }),
      {
        stage: APPROVAL_STAGES.HOMEROOM_TEACHER,
        decision: 'SIGNED',
        actor: teacher,
        teacherActivityPriority: true,
        exemptReason: '班際球賽練習',
        today: TODAY,
      },
      NOW,
    );
    expect(result.status).toBe(CASE_STATUS.EXEMPTED);
    expect(result.countsTowardRecidivism).toBe(false);
    expect(result.approvals[0]?.decision).toBe('EXEMPTED');
    expect(result.effects).toEqual(
      expect.arrayContaining([
        { type: 'EXEMPT_INFRACTION', reason: '班際球賽練習' },
        {
          type: 'LIFT_RESTRICTION',
          date: '2026-09-17',
          reason: 'INFRACTION_REFLECTION',
          note: '班際球賽練習',
        },
        { type: 'EVALUATE_RECIDIVISM', asOf: '2026-09-17' },
      ]),
    );
  });

  it('生教組關卡不得勾選班級活動優先', () => {
    expect(() =>
      reviewCase(
        snapshot({ status: CASE_STATUS.PENDING_OFFICE }),
        {
          stage: APPROVAL_STAGES.DISCIPLINE_OFFICE,
          decision: 'SIGNED',
          actor: office,
          teacherActivityPriority: true,
          today: TODAY,
        },
        NOW,
      ),
    ).toThrow(/僅限導師關卡/);
  });

  it('未填原因時使用預設事由', () => {
    const result = reviewCase(
      snapshot({ status: CASE_STATUS.PENDING_TEACHER }),
      {
        stage: APPROVAL_STAGES.HOMEROOM_TEACHER,
        decision: 'SIGNED',
        actor: teacher,
        teacherActivityPriority: true,
        today: TODAY,
      },
      NOW,
    );
    expect(result.approvals[0]?.comment).toBe('導師班級活動優先，該時段不計入處分');
  });
});

describe('第二層：生教組蓋章', () => {
  it('反思卡完成 → 當日解除下課管制', () => {
    const result = reviewCase(
      snapshot({ status: CASE_STATUS.PENDING_OFFICE }),
      { stage: APPROVAL_STAGES.DISCIPLINE_OFFICE, decision: 'SIGNED', actor: office, today: TODAY },
      NOW,
    );
    expect(result.status).toBe(CASE_STATUS.COMPLETED);
    expect(result.completedAt).toBe(NOW);
    expect(result.officeStampedAt).toBe(NOW);
    expect(result.effects[0]).toMatchObject({
      type: 'LIFT_RESTRICTION',
      date: TODAY,
      reason: 'INFRACTION_REFLECTION',
    });
  });

  it('行為檢討書完成 → 隔日（下一個上課日）解鎖並結束派單', () => {
    const result = reviewCase(
      snapshot({ kind: 'CONDUCT_REVIEW', status: CASE_STATUS.PENDING_OFFICE }),
      {
        stage: APPROVAL_STAGES.DISCIPLINE_OFFICE,
        decision: 'SIGNED',
        actor: office,
        today: TODAY, // 週五
      },
      NOW,
    );
    expect(result.status).toBe(CASE_STATUS.COMPLETED);
    expect(result.unlockOn).toBe('2026-09-21'); // 跳過週末
    expect(result.effects).toEqual(
      expect.arrayContaining([
        { type: 'SCHEDULE_UNLOCK', date: '2026-09-21' },
        { type: 'CLOSE_ASSIGNMENT' },
      ]),
    );
  });

  it('檢討書解鎖日遵循校曆（連假順延）', () => {
    const calendar = createSchoolCalendar({ '2026-09-21': false, '2026-09-22': false });
    const result = reviewCase(
      snapshot({ kind: 'CONDUCT_REVIEW', status: CASE_STATUS.PENDING_OFFICE }),
      {
        stage: APPROVAL_STAGES.DISCIPLINE_OFFICE,
        decision: 'SIGNED',
        actor: office,
        calendar,
        today: TODAY,
      },
      NOW,
    );
    expect(result.unlockOn).toBe('2026-09-23');
  });
});

describe('輔助判斷', () => {
  it('canActOnStage', () => {
    expect(canActOnStage([ROLES.HOMEROOM_TEACHER], APPROVAL_STAGES.HOMEROOM_TEACHER)).toBe(true);
    expect(canActOnStage([ROLES.HOMEROOM_TEACHER], APPROVAL_STAGES.DISCIPLINE_OFFICE)).toBe(false);
    expect(canActOnStage([ROLES.ADMIN], APPROVAL_STAGES.DISCIPLINE_OFFICE)).toBe(true);
  });

  it('isTerminal / pendingStage', () => {
    expect(isTerminal(CASE_STATUS.COMPLETED)).toBe(true);
    expect(isTerminal(CASE_STATUS.EXEMPTED)).toBe(true);
    expect(isTerminal(CASE_STATUS.PENDING_OFFICE)).toBe(false);
    expect(pendingStage(CASE_STATUS.PENDING_TEACHER)).toBe(APPROVAL_STAGES.HOMEROOM_TEACHER);
    expect(pendingStage(CASE_STATUS.PENDING_OFFICE)).toBe(APPROVAL_STAGES.DISCIPLINE_OFFICE);
    expect(pendingStage(CASE_STATUS.COMPLETED)).toBeNull();
  });
});
