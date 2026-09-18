/**
 * 雙軌反思卡 / 行為檢討書之工作流狀態機
 * =====================================
 *
 * 狀態流轉：
 *
 *   DRAFT ──submit──▶ PENDING_TEACHER ──sign(導師)──▶ PENDING_OFFICE
 *     ▲                     │                              │
 *     │                     ├─return──▶ RETURNED ──resubmit┘（回到 PENDING_TEACHER）
 *     │                     │
 *     └─────────────────────┴─exempt(班級活動優先)──▶ EXEMPTED（不計入處分）
 *
 *   PENDING_OFFICE ──stamp(生教組)──▶ COMPLETED
 *                  └─return────────▶ RETURNED
 *
 * 解鎖規則：
 *  - 反思卡 COMPLETED → **當日**自動解除下課管制。
 *  - 行為檢討書 COMPLETED → 解鎖日 = 完成日的**下一個上課日**（隔日解鎖）。
 *
 * 本模組為純函式：回傳「新狀態 + 副作用清單（effects）」，
 * 實際的 Firestore 寫入、推播、解鎖由 services 層依 effects 執行。
 */

import { nextSchoolDay, type SchoolCalendar } from './dates.js';
import {
  APPROVAL_STAGES,
  type ApprovalDecision,
  type ApprovalRecord,
  type ApprovalStage,
  CASE_STATUS,
  type CaseStatus,
  type IsoTimestamp,
  type RestrictionReason,
  RESTRICTION_REASONS,
  type Role,
  ROLES,
  type SchoolDate,
} from './types.js';

export type CaseKind = 'REFLECTION_CARD' | 'CONDUCT_REVIEW';

export type WorkflowErrorCode =
  | 'INVALID_STATE'
  | 'PERMISSION_DENIED'
  | 'STAGE_MISMATCH'
  | 'COMMENT_REQUIRED'
  | 'REASON_REQUIRED';

export class WorkflowError extends Error {
  constructor(
    readonly code: WorkflowErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WorkflowError';
  }
}

export interface ActorContext {
  uid: string;
  name: string;
  roles: Role[];
}

export interface CaseSnapshot {
  kind: CaseKind;
  status: CaseStatus;
  approvals: ApprovalRecord[];
  returnCount: number;
  /** 案件基準日：反思卡 = 違規發生日；檢討書 = 值勤日 */
  baseDate: SchoolDate;
}

/** 狀態機產生的副作用，由 services 層落實 */
export type WorkflowEffect =
  /** 觸發累犯偵測（以 asOf 為基準日回溯視窗） */
  | { type: 'EVALUATE_RECIDIVISM'; asOf: SchoolDate }
  /** 解除下課管制 */
  | { type: 'LIFT_RESTRICTION'; date: SchoolDate; reason: RestrictionReason; note: string }
  /** 導師班級活動優先 → 該時段不計入處分 */
  | { type: 'EXEMPT_INFRACTION'; reason: string }
  /** 安排隔日解鎖（安全觀察員結案） */
  | { type: 'SCHEDULE_UNLOCK'; date: SchoolDate }
  /** 結束安全觀察員派單 */
  | { type: 'CLOSE_ASSIGNMENT' }
  /** 發送通知 */
  | {
      type: 'NOTIFY';
      templateCode: string;
      audience: 'HOMEROOM_TEACHER' | 'DISCIPLINE_OFFICE' | 'STUDENT' | 'GUARDIAN';
    };

export interface TransitionResult {
  status: CaseStatus;
  approvals: ApprovalRecord[];
  returnCount: number;
  effects: WorkflowEffect[];
  /** 完成雙重審核時填入 */
  completedAt?: IsoTimestamp;
  teacherSignedAt?: IsoTimestamp;
  officeStampedAt?: IsoTimestamp;
  /** 檢討書的隔日解鎖日 */
  unlockOn?: SchoolDate;
  /** 是否仍計入累犯統計（豁免 → false） */
  countsTowardRecidivism?: boolean;
}

/** 各關卡允許的角色 */
const STAGE_ROLES: Record<ApprovalStage, Role[]> = {
  [APPROVAL_STAGES.HOMEROOM_TEACHER]: [ROLES.HOMEROOM_TEACHER, ROLES.ADMIN],
  [APPROVAL_STAGES.DISCIPLINE_OFFICE]: [ROLES.DISCIPLINE_STAFF, ROLES.ADMIN],
};

/** 各關卡對應的前置狀態 */
const STAGE_REQUIRED_STATUS: Record<ApprovalStage, CaseStatus> = {
  [APPROVAL_STAGES.HOMEROOM_TEACHER]: CASE_STATUS.PENDING_TEACHER,
  [APPROVAL_STAGES.DISCIPLINE_OFFICE]: CASE_STATUS.PENDING_OFFICE,
};

export function canActOnStage(roles: Role[], stage: ApprovalStage): boolean {
  return roles.some((role) => STAGE_ROLES[stage].includes(role));
}

/** 學生送出（或退回後重新送出） */
export function submitCase(
  snapshot: CaseSnapshot,
  actor: ActorContext,
  now: IsoTimestamp,
): TransitionResult {
  const submittable: CaseStatus[] = [CASE_STATUS.DRAFT, CASE_STATUS.RETURNED];
  if (!submittable.includes(snapshot.status)) {
    throw new WorkflowError(
      'INVALID_STATE',
      `狀態 ${snapshot.status} 不可送出（僅 DRAFT / RETURNED 可送出）`,
    );
  }
  if (!actor.roles.includes(ROLES.STUDENT) && !actor.roles.includes(ROLES.ADMIN)) {
    throw new WorkflowError('PERMISSION_DENIED', '僅學生本人可送出反思卡／檢討書');
  }

  const effects: WorkflowEffect[] = [
    {
      type: 'NOTIFY',
      templateCode:
        snapshot.kind === 'REFLECTION_CARD'
          ? 'REFLECTION_SUBMITTED_TO_TEACHER'
          : 'CONDUCT_REVIEW_SUBMITTED_TO_TEACHER',
      audience: 'HOMEROOM_TEACHER',
    },
  ];
  // 規格：以「填寫紀錄」為累犯計數基礎 → 學生送出即納入視窗重新評估
  if (snapshot.kind === 'REFLECTION_CARD') {
    effects.push({ type: 'EVALUATE_RECIDIVISM', asOf: snapshot.baseDate });
  }

  return {
    status: CASE_STATUS.PENDING_TEACHER,
    approvals: snapshot.approvals,
    returnCount: snapshot.returnCount,
    effects,
  };
}

export interface ReviewInput {
  stage: ApprovalStage;
  decision: ApprovalDecision;
  actor: ActorContext;
  comment?: string;
  signatureHash?: string;
  /**
   * 導師端「導師班級活動優先」勾選鈕：
   * 勾選後該時段不計入處分，案件結案為 EXEMPTED 並解除當日管制。
   */
  teacherActivityPriority?: boolean;
  exemptReason?: string;
  /** 檢討書隔日解鎖需要校曆 */
  calendar?: SchoolCalendar;
  /** 完成當日（Asia/Taipei） */
  today: SchoolDate;
}

/** 導師簽章 / 生教組蓋章 / 退回 / 豁免 */
export function reviewCase(
  snapshot: CaseSnapshot,
  input: ReviewInput,
  now: IsoTimestamp,
): TransitionResult {
  const { stage, actor } = input;

  if (!canActOnStage(actor.roles, stage)) {
    throw new WorkflowError(
      'PERMISSION_DENIED',
      `角色 [${actor.roles.join(',')}] 無權於 ${stage} 關卡簽核`,
    );
  }
  if (snapshot.status !== STAGE_REQUIRED_STATUS[stage]) {
    throw new WorkflowError(
      'STAGE_MISMATCH',
      `案件現況為 ${snapshot.status}，不在 ${stage} 的待辦狀態（應為 ${STAGE_REQUIRED_STATUS[stage]}）`,
    );
  }

  // 導師勾選班級活動優先 → 直接豁免結案
  if (input.teacherActivityPriority) {
    if (stage !== APPROVAL_STAGES.HOMEROOM_TEACHER) {
      throw new WorkflowError('STAGE_MISMATCH', '「導師班級活動優先」僅限導師關卡勾選');
    }
    const reason = input.exemptReason?.trim() || '導師班級活動優先，該時段不計入處分';
    const approval: ApprovalRecord = {
      stage,
      decision: 'EXEMPTED',
      actorUid: actor.uid,
      actorName: actor.name,
      comment: reason,
      signatureHash: input.signatureHash,
      actedAt: now,
    };
    return {
      status: CASE_STATUS.EXEMPTED,
      approvals: [...snapshot.approvals, approval],
      returnCount: snapshot.returnCount,
      countsTowardRecidivism: false,
      effects: [
        { type: 'EXEMPT_INFRACTION', reason },
        {
          type: 'LIFT_RESTRICTION',
          date: snapshot.baseDate,
          reason: RESTRICTION_REASONS.INFRACTION_REFLECTION,
          note: reason,
        },
        { type: 'NOTIFY', templateCode: 'CASE_EXEMPTED', audience: 'STUDENT' },
        // 豁免後該卡不再計入，須重新評估（可能撤下尚未處分的警示）
        { type: 'EVALUATE_RECIDIVISM', asOf: snapshot.baseDate },
      ],
    };
  }

  if (input.decision === 'RETURNED') {
    if (!input.comment?.trim()) {
      throw new WorkflowError('COMMENT_REQUIRED', '退回補正必須填寫退回原因，以符合正向管教之說明義務');
    }
    const approval: ApprovalRecord = {
      stage,
      decision: 'RETURNED',
      actorUid: actor.uid,
      actorName: actor.name,
      comment: input.comment.trim(),
      actedAt: now,
    };
    return {
      status: CASE_STATUS.RETURNED,
      approvals: [...snapshot.approvals, approval],
      returnCount: snapshot.returnCount + 1,
      effects: [{ type: 'NOTIFY', templateCode: 'CASE_RETURNED', audience: 'STUDENT' }],
    };
  }

  // decision === 'SIGNED'
  const approval: ApprovalRecord = {
    stage,
    decision: 'SIGNED',
    actorUid: actor.uid,
    actorName: actor.name,
    comment: input.comment?.trim(),
    signatureHash: input.signatureHash,
    actedAt: now,
  };
  const approvals = [...snapshot.approvals, approval];

  if (stage === APPROVAL_STAGES.HOMEROOM_TEACHER) {
    return {
      status: CASE_STATUS.PENDING_OFFICE,
      approvals,
      returnCount: snapshot.returnCount,
      teacherSignedAt: now,
      effects: [
        {
          type: 'NOTIFY',
          templateCode: 'CASE_PENDING_OFFICE',
          audience: 'DISCIPLINE_OFFICE',
        },
      ],
    };
  }

  // 生教組蓋章 → 完成
  if (snapshot.kind === 'REFLECTION_CARD') {
    return {
      status: CASE_STATUS.COMPLETED,
      approvals,
      returnCount: snapshot.returnCount,
      officeStampedAt: now,
      completedAt: now,
      effects: [
        // 反思卡：當日完成 → 當日解除下課管制
        {
          type: 'LIFT_RESTRICTION',
          date: input.today,
          reason: RESTRICTION_REASONS.INFRACTION_REFLECTION,
          note: '反思卡已完成導師簽章與生教組蓋章，當日解除下課管制',
        },
        { type: 'NOTIFY', templateCode: 'REFLECTION_COMPLETED', audience: 'STUDENT' },
      ],
    };
  }

  // 行為檢討書：通過後「隔日」才解鎖
  const unlockOn = nextSchoolDay(input.today, input.calendar);
  return {
    status: CASE_STATUS.COMPLETED,
    approvals,
    returnCount: snapshot.returnCount,
    officeStampedAt: now,
    completedAt: now,
    unlockOn,
    effects: [
      { type: 'SCHEDULE_UNLOCK', date: unlockOn },
      { type: 'CLOSE_ASSIGNMENT' },
      { type: 'NOTIFY', templateCode: 'CONDUCT_REVIEW_COMPLETED', audience: 'STUDENT' },
      { type: 'NOTIFY', templateCode: 'CONDUCT_REVIEW_COMPLETED', audience: 'HOMEROOM_TEACHER' },
    ],
  };
}

/** 案件是否已結束（不需再出現在待辦佇列） */
export function isTerminal(status: CaseStatus): boolean {
  return (
    status === CASE_STATUS.COMPLETED ||
    status === CASE_STATUS.EXEMPTED ||
    status === CASE_STATUS.VOIDED
  );
}

/** 案件目前卡在哪個關卡（給儀表板顯示） */
export function pendingStage(status: CaseStatus): ApprovalStage | null {
  if (status === CASE_STATUS.PENDING_TEACHER) return APPROVAL_STAGES.HOMEROOM_TEACHER;
  if (status === CASE_STATUS.PENDING_OFFICE) return APPROVAL_STAGES.DISCIPLINE_OFFICE;
  return null;
}
