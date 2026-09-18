/**
 * C.A.R.E. System — 領域模型型別定義
 *
 * 本檔案為「純領域層」：不依賴 firebase-admin / firestore，
 * 讓核心邏輯（累犯偵測、工作流狀態機）可獨立單元測試。
 *
 * 時間表示原則：
 *  - `SchoolDate`：校務日期字串 `YYYY-MM-DD`，一律以 Asia/Taipei 計算，
 *    用於所有「天數視窗」運算（15 天累犯視窗、下課管制帳、隔日解鎖）。
 *  - `IsoTimestamp`：ISO-8601 時間字串，用於稽核與排序。
 *    Firestore 端以 Timestamp 儲存，於 data 層轉換。
 */

/** 校務日期 `YYYY-MM-DD`（Asia/Taipei） */
export type SchoolDate = string;
/** ISO-8601 時間字串，例：2026-09-18T03:12:45.000Z */
export type IsoTimestamp = string;

/* ------------------------------------------------------------------ *
 * 角色
 * ------------------------------------------------------------------ */

export const ROLES = {
  /** 學生 */
  STUDENT: 'STUDENT',
  /** 班級導師 */
  HOMEROOM_TEACHER: 'HOMEROOM_TEACHER',
  /** 生活教育組（生教組） */
  DISCIPLINE_STAFF: 'DISCIPLINE_STAFF',
  /** 糾察隊 / 巡堂教師（僅可登錄違規） */
  PATROL: 'PATROL',
  /** 系統管理者 */
  ADMIN: 'ADMIN',
} as const;
export type Role = (typeof ROLES)[keyof typeof ROLES];

/* ------------------------------------------------------------------ *
 * 違規類型與表單
 * ------------------------------------------------------------------ */

/** 內建違規類型代碼；可於 `infractionTypes` 集合新增自訂類型 */
export const BUILTIN_INFRACTION_TYPES = {
  /** 走廊奔跑 */
  RUN_IN_CORRIDOR: 'RUN_IN_CORRIDOR',
  /** 口出穢言 */
  FOUL_LANGUAGE: 'FOUL_LANGUAGE',
} as const;
export type InfractionTypeCode = string;

/** 表單種類（雙軌反思卡 + 行為檢討書） */
export const FORM_KINDS = {
  /** 校園安全反思卡（走廊奔跑） */
  SAFETY_REFLECTION: 'SAFETY_REFLECTION',
  /** 口說好話反思卡（口出穢言） */
  KIND_WORDS_REFLECTION: 'KIND_WORDS_REFLECTION',
  /** 行為檢討書（安全觀察員結案用） */
  CONDUCT_REVIEW: 'CONDUCT_REVIEW',
} as const;
export type FormKind = (typeof FORM_KINDS)[keyof typeof FORM_KINDS];

/* ------------------------------------------------------------------ *
 * 案件（反思卡 / 檢討書）共用之工作流狀態
 * ------------------------------------------------------------------ */

export const CASE_STATUS = {
  /** 學生填寫中（暫存） */
  DRAFT: 'DRAFT',
  /** 學生已送出，待導師簽章 */
  PENDING_TEACHER: 'PENDING_TEACHER',
  /** 導師已簽章，待生教組蓋章 */
  PENDING_OFFICE: 'PENDING_OFFICE',
  /** 雙重審核完成（導師簽章 + 生教組蓋章） */
  COMPLETED: 'COMPLETED',
  /** 被退回補正（回到學生端） */
  RETURNED: 'RETURNED',
  /** 導師勾選「班級活動優先」→ 該時段不計入處分 */
  EXEMPTED: 'EXEMPTED',
  /** 誤報 / 撤銷 */
  VOIDED: 'VOIDED',
} as const;
export type CaseStatus = (typeof CASE_STATUS)[keyof typeof CASE_STATUS];

/** 審核關卡 */
export const APPROVAL_STAGES = {
  /** 第一層：班導師簽章 */
  HOMEROOM_TEACHER: 'HOMEROOM_TEACHER',
  /** 第二層：生教組蓋章 */
  DISCIPLINE_OFFICE: 'DISCIPLINE_OFFICE',
} as const;
export type ApprovalStage = (typeof APPROVAL_STAGES)[keyof typeof APPROVAL_STAGES];

export type ApprovalDecision = 'SIGNED' | 'RETURNED' | 'EXEMPTED';

export interface ApprovalRecord {
  stage: ApprovalStage;
  decision: ApprovalDecision;
  actorUid: string;
  actorName: string;
  comment?: string;
  /** 電子簽章／印信雜湊（簽章內容 + 時戳 + uid 的 SHA-256），供事後驗證 */
  signatureHash?: string;
  actedAt: IsoTimestamp;
}

/* ------------------------------------------------------------------ *
 * 違規事件
 * ------------------------------------------------------------------ */

export const INFRACTION_STATUS = {
  /** 已登錄，待學生完成反思卡 */
  OPEN: 'OPEN',
  /** 反思卡雙重審核完成 */
  RESOLVED: 'RESOLVED',
  /** 導師勾選班級活動優先，不計入處分 */
  EXEMPTED: 'EXEMPTED',
  /** 撤銷（誤報） */
  VOIDED: 'VOIDED',
} as const;
export type InfractionStatus = (typeof INFRACTION_STATUS)[keyof typeof INFRACTION_STATUS];

export interface Infraction {
  id: string;
  studentId: string;
  /** 反正規化欄位，供清單/匯出直接顯示，避免 N+1 讀取 */
  studentNo: string;
  studentName: string;
  classId: string;
  className: string;
  typeCode: InfractionTypeCode;
  typeName: string;
  formKind: FormKind;
  occurredAt: IsoTimestamp;
  /** 違規發生之校務日期，同時是累犯視窗的基準日 */
  occurredOn: SchoolDate;
  /** 節次（1..8）；0 表示非課間 */
  periodNo: number;
  locationCode: string;
  locationName: string;
  locationDetail?: string;
  description?: string;
  reporter: { uid: string; name: string; role: Role };
  status: InfractionStatus;
  reflectionCardId?: string;
  /** 導師「班級活動優先」豁免 */
  exemption?: {
    applied: true;
    reason: string;
    byUid: string;
    byName: string;
    at: IsoTimestamp;
  };
  voidReason?: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/* ------------------------------------------------------------------ *
 * 反思卡
 * ------------------------------------------------------------------ */

export interface ReflectionCard {
  id: string;
  infractionId: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  classId: string;
  templateId: string;
  templateVersion: number;
  formKind: FormKind;
  status: CaseStatus;
  /** 累犯計算基準日（= 違規發生日 occurredOn），不因補填日期而漂移 */
  countOn: SchoolDate;
  /** 是否計入累犯統計（導師豁免 / 撤銷 → false） */
  countsTowardRecidivism: boolean;
  /**
   * 已被某次累犯警示「認列」的 alertId。
   * 認列後不再參與後續視窗計數，避免第 4、5 張卡重複觸發同一波處分。
   * 未認列時必須明確寫入 null（Firestore 不索引缺漏欄位）。
   */
  consumedByAlertId: string | null;
  answers: Record<string, unknown>;
  submittedAt?: IsoTimestamp;
  approvals: ApprovalRecord[];
  teacherSignedAt?: IsoTimestamp;
  officeStampedAt?: IsoTimestamp;
  completedAt?: IsoTimestamp;
  returnCount: number;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/* ------------------------------------------------------------------ *
 * 下課管制（每日帳）
 * ------------------------------------------------------------------ */

export const RESTRICTION_REASONS = {
  /** 違規登錄 → 凍結當日自由下課，待完成反思卡 */
  INFRACTION_REFLECTION: 'INFRACTION_REFLECTION',
  /** 安全觀察員值勤日 */
  OBSERVER_DUTY: 'OBSERVER_DUTY',
  /** 值勤結束但檢討書尚未通過 */
  OBSERVER_REVIEW_PENDING: 'OBSERVER_REVIEW_PENDING',
} as const;
export type RestrictionReason =
  (typeof RESTRICTION_REASONS)[keyof typeof RESTRICTION_REASONS];

export interface RecessRestriction {
  /** 文件 ID = `${studentId}_${date}`（每生每日一筆，天然去重） */
  id: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  classId: string;
  className: string;
  date: SchoolDate;
  /** 同日可能同時存在多個管制來源 */
  reasons: RestrictionReason[];
  sourceRefs: Array<{
    reason: RestrictionReason;
    infractionId?: string;
    assignmentId?: string;
  }>;
  status: 'ACTIVE' | 'LIFTED' | 'CANCELLED';
  /** 正向管教保障：管制期間仍可正常飲水與如廁 */
  allowWaterAndRestroom: true;
  /** 管制節次（安全觀察員為 5 節，扣除打掃時間與 5 分鐘短下課） */
  periods: number[];
  liftedAt?: IsoTimestamp;
  liftReason?: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/* ------------------------------------------------------------------ *
 * 累犯警示
 * ------------------------------------------------------------------ */

export const ALERT_STATUS = {
  /** 已觸發，待生教組確認 */
  OPEN: 'OPEN',
  /** 生教組已確認 */
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  /** 已派安全觀察員 */
  ASSIGNED: 'ASSIGNED',
  /** 結案 */
  CLOSED: 'CLOSED',
  /** 撤銷（誤判） */
  DISMISSED: 'DISMISSED',
} as const;
export type AlertStatus = (typeof ALERT_STATUS)[keyof typeof ALERT_STATUS];

export interface RecidivismAlert {
  id: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  classId: string;
  className: string;
  triggeredAt: IsoTimestamp;
  /** 視窗設定快照（日後調參不影響既有案件的可追溯性） */
  windowDays: number;
  threshold: number;
  windowStart: SchoolDate;
  windowEnd: SchoolDate;
  cardCount: number;
  /** 觸發本次警示的最後一張卡 */
  triggerCardId: string;
  /** 本次警示認列的卡片（長度 = cardCount） */
  cardIds: string[];
  breakdown: Array<{ cardId: string; formKind: FormKind; countOn: SchoolDate }>;
  status: AlertStatus;
  assignmentId?: string;
  acknowledgedBy?: { uid: string; name: string; at: IsoTimestamp };
  note?: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/* ------------------------------------------------------------------ *
 * 安全觀察員
 * ------------------------------------------------------------------ */

export const ASSIGNMENT_STATUS = {
  /** 已排定值勤日 */
  SCHEDULED: 'SCHEDULED',
  /** 值勤中（已報到） */
  IN_PROGRESS: 'IN_PROGRESS',
  /** 值勤完成，待提交行為檢討書 */
  DUTY_COMPLETED: 'DUTY_COMPLETED',
  /** 檢討書審核中 */
  REVIEW_PENDING: 'REVIEW_PENDING',
  /** 結案（檢討書通過，隔日解鎖） */
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
} as const;
export type AssignmentStatus =
  (typeof ASSIGNMENT_STATUS)[keyof typeof ASSIGNMENT_STATUS];

export interface ObserverPeriodLog {
  periodNo: number;
  checkInAt?: IsoTimestamp;
  checkOutAt?: IsoTimestamp;
  /** 觀察紀錄：勸導人數、地點、心得 */
  observedCount?: number;
  note?: string;
  verifiedByUid?: string;
}

export interface ObserverAssignment {
  id: string;
  alertId: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  classId: string;
  className: string;
  /** 值勤日（一日下課，共 5 節） */
  dutyOn: SchoolDate;
  totalPeriods: number;
  periodLogs: ObserverPeriodLog[];
  supervisor?: { uid: string; name: string };
  status: AssignmentStatus;
  conductReviewId?: string;
  /** 檢討書通過後的「隔日」解鎖日（下一個上課日） */
  unlockOn?: SchoolDate;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface ConductReview {
  id: string;
  assignmentId: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  classId: string;
  templateId: string;
  templateVersion: number;
  status: CaseStatus;
  answers: Record<string, unknown>;
  submittedAt?: IsoTimestamp;
  approvals: ApprovalRecord[];
  teacherSignedAt?: IsoTimestamp;
  officeStampedAt?: IsoTimestamp;
  completedAt?: IsoTimestamp;
  /** 完成審核之校務日期，解鎖日 = 其下一個上課日 */
  completedOn?: SchoolDate;
  unlockOn?: SchoolDate;
  returnCount: number;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/* ------------------------------------------------------------------ *
 * 系統設定
 * ------------------------------------------------------------------ */

export interface SystemSettings {
  /** 累犯偵測回溯天數（含當天）— 預設 15 */
  recidivismWindowDays: number;
  /** 觸發門檻張數 — 預設 3 */
  recidivismThreshold: number;
  /** 安全觀察員值勤節數 — 預設 5 */
  observerPeriods: number;
  /** 管制節次清單（扣除打掃與 5 分鐘短下課） */
  observerPeriodNumbers: number[];
  /** 時區，一律 Asia/Taipei */
  timezone: string;
  /** 通知管道開關 */
  notifications: { push: boolean; email: boolean };
}

export const DEFAULT_SETTINGS: SystemSettings = {
  recidivismWindowDays: 15,
  recidivismThreshold: 3,
  observerPeriods: 5,
  observerPeriodNumbers: [1, 2, 3, 4, 5],
  timezone: 'Asia/Taipei',
  notifications: { push: true, email: true },
};
