/**
 * C.A.R.E. System — 領域模型型別定義
 *
 * 架構（v3・免費方案）：
 *   不使用 Cloud Functions（需付費方案）。所有邏輯在前端執行，
 *   以 Firestore 交易保證原子性，並由安全規則驗證每一筆寫入的形狀與權限。
 *   角色存於 `staff/{uid}.roles`，規則以 get() 讀取判定。
 *
 * 系統定位：
 *   生活教育組長一人操作的「違規登錄 + 再犯追蹤」工具。
 *   反思卡與行為檢討書維持**紙本**作業，系統只紀錄「是否回收」以決定管制解除，
 *   核心價值在於自動計算「15 天內再犯次數」與後續的安全觀察員派單追蹤。
 *
 * 時間表示原則：
 *  - `SchoolDate`：校務日期字串 `YYYY-MM-DD`，一律以 Asia/Taipei 計算。
 *  - `IsoTimestamp`：ISO-8601 時間字串（UTC），由伺服器產生。
 */

/** 校務日期 `YYYY-MM-DD`（Asia/Taipei） */
export type SchoolDate = string;
/** ISO-8601 時間字串 */
export type IsoTimestamp = string;

/* ------------------------------------------------------------------ *
 * 角色（單人系統，僅兩種身分）
 * ------------------------------------------------------------------ */

export const ROLES = {
  /** 生活教育組長（唯一具備寫入權限的身分） */
  DISCIPLINE_STAFF: 'DISCIPLINE_STAFF',
  /** 系統管理者（設定與帳號維護） */
  ADMIN: 'ADMIN',
} as const;
export type Role = (typeof ROLES)[keyof typeof ROLES];

/* ------------------------------------------------------------------ *
 * 違規類型與對應紙本卡
 * ------------------------------------------------------------------ */

export const BUILTIN_INFRACTION_TYPES = {
  /** 走廊奔跑 → 校園安全反思卡 */
  RUN_IN_CORRIDOR: 'RUN_IN_CORRIDOR',
  /** 口出穢言 → 口說好話反思卡 */
  FOUL_LANGUAGE: 'FOUL_LANGUAGE',
} as const;
export type InfractionTypeCode = string;

/** 紙本反思卡種類（僅作顯示與統計分類用；填寫在紙上） */
export const PAPER_CARDS = {
  /** 校園安全反思卡 */
  SAFETY: 'SAFETY',
  /** 口說好話反思卡 */
  KIND_WORDS: 'KIND_WORDS',
} as const;
export type PaperCard = (typeof PAPER_CARDS)[keyof typeof PAPER_CARDS];

export const PAPER_CARD_LABEL: Record<PaperCard, string> = {
  SAFETY: '校園安全反思卡',
  KIND_WORDS: '口說好話反思卡',
};

/* ------------------------------------------------------------------ *
 * 違規事件（累犯計數的唯一來源）
 * ------------------------------------------------------------------ */

export const INFRACTION_STATUS = {
  /** 已登錄，紙本反思卡尚未回收 → 下課管制中 */
  OPEN: 'OPEN',
  /** 紙本反思卡已回收 → 當日解除管制 */
  DONE: 'DONE',
  /** 班級活動優先或其他事由免記，不計入再犯 */
  EXEMPTED: 'EXEMPTED',
  /** 誤報撤銷，不計入再犯 */
  VOIDED: 'VOIDED',
} as const;
export type InfractionStatus = (typeof INFRACTION_STATUS)[keyof typeof INFRACTION_STATUS];

export interface Infraction {
  id: string;
  studentId: string;
  /** 反正規化欄位，供清單與匯出直接顯示 */
  studentNo: string;
  studentName: string;
  classId: string;
  className: string;
  seatNo?: number;

  typeCode: InfractionTypeCode;
  typeName: string;
  /** 應發的紙本反思卡 */
  paperCard: PaperCard;

  occurredAt: IsoTimestamp;
  /** 違規發生之校務日期，同時是再犯視窗的基準日 */
  occurredOn: SchoolDate;
  /** 節次（1..8）；0 表示非課間 */
  periodNo: number;
  locationCode: string;
  locationName: string;
  note?: string;

  recordedBy: { uid: string; name: string };

  status: InfractionStatus;
  /** 紙本反思卡回收時間 */
  paperReturnedAt?: IsoTimestamp;
  paperReturnedOn?: SchoolDate;
  exemptReason?: string;
  voidReason?: string;

  /** 是否計入再犯統計（豁免／撤銷 → false） */
  countsTowardRecidivism: boolean;
  /**
   * 已被某次再犯警示「認列」的 alertId。
   * 認列後不再參與後續視窗計數，避免第 4、5 次重複觸發同一波處分。
   * 未認列時必須明確寫入 null（Firestore 不索引缺漏欄位）。
   */
  consumedByAlertId: string | null;

  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/* ------------------------------------------------------------------ *
 * 下課管制（每日帳）
 * ------------------------------------------------------------------ */

export const RESTRICTION_REASONS = {
  /** 違規登錄 → 凍結當日自由下課，待紙本反思卡回收 */
  INFRACTION_PAPER: 'INFRACTION_PAPER',
  /** 安全觀察員值勤日 */
  OBSERVER_DUTY: 'OBSERVER_DUTY',
  /** 值勤結束但紙本行為檢討書尚未回收 */
  OBSERVER_REVIEW_PENDING: 'OBSERVER_REVIEW_PENDING',
} as const;
export type RestrictionReason =
  (typeof RESTRICTION_REASONS)[keyof typeof RESTRICTION_REASONS];

export const RESTRICTION_REASON_LABEL: Record<RestrictionReason, string> = {
  INFRACTION_PAPER: '待回收反思卡',
  OBSERVER_DUTY: '安全觀察員值勤',
  OBSERVER_REVIEW_PENDING: '待回收檢討書',
};

export interface RecessRestriction {
  /** 文件 ID = `${studentId}_${date}`（每生每日一筆，天然去重） */
  id: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  classId: string;
  className: string;
  seatNo?: number;
  date: SchoolDate;
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
  note?: string;
  liftedAt?: IsoTimestamp;
  liftReason?: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/* ------------------------------------------------------------------ *
 * 再犯警示
 * ------------------------------------------------------------------ */

export const ALERT_STATUS = {
  OPEN: 'OPEN',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  ASSIGNED: 'ASSIGNED',
  CLOSED: 'CLOSED',
  DISMISSED: 'DISMISSED',
} as const;
export type AlertStatus = (typeof ALERT_STATUS)[keyof typeof ALERT_STATUS];

export const ALERT_STATUS_LABEL: Record<AlertStatus, string> = {
  OPEN: '待處理',
  ACKNOWLEDGED: '已確認',
  ASSIGNED: '已派安全觀察員',
  CLOSED: '已結案',
  DISMISSED: '已撤銷',
};

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
  count: number;
  /** 觸發本次警示的最後一筆違規 */
  triggerInfractionId: string;
  /** 本次警示認列的違規（長度 = count） */
  infractionIds: string[];
  breakdown: Array<{ infractionId: string; typeName: string; occurredOn: SchoolDate }>;
  status: AlertStatus;
  assignmentId?: string;
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
  /** 值勤完成，待回收紙本行為檢討書 */
  DUTY_COMPLETED: 'DUTY_COMPLETED',
  /** 已回收檢討書，隔日解鎖 */
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
} as const;
export type AssignmentStatus =
  (typeof ASSIGNMENT_STATUS)[keyof typeof ASSIGNMENT_STATUS];

export const ASSIGNMENT_STATUS_LABEL: Record<AssignmentStatus, string> = {
  SCHEDULED: '已排定',
  IN_PROGRESS: '值勤中',
  DUTY_COMPLETED: '待回收檢討書',
  CLOSED: '已結案',
  CANCELLED: '已取消',
};

export interface ObserverPeriodLog {
  periodNo: number;
  checkInAt?: IsoTimestamp;
  checkOutAt?: IsoTimestamp;
  /** 勸導人數 */
  observedCount?: number;
  note?: string;
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
  status: AssignmentStatus;
  /** 紙本行為檢討書回收 */
  reviewReturnedAt?: IsoTimestamp;
  reviewReturnedOn?: SchoolDate;
  /** 檢討書回收後的「隔日」解鎖日（下一個上課日） */
  unlockOn?: SchoolDate;
  rescheduleReason?: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/* ------------------------------------------------------------------ *
 * 系統設定
 * ------------------------------------------------------------------ */

/** 教職員帳號（角色的真實來源；安全規則以 get() 讀取此文件判定權限） */
export interface StaffRecord {
  uid: string;
  email: string;
  name: string;
  roles: Role[];
  active: boolean;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/**
 * 以 Google 信箱預先授權的名單。
 * 前端**不可讀取**（避免列舉校內信箱），但安全規則的 get() 仍可讀，
 * 因此使用者首次登入時可據此建立自己的 staff 文件。
 */
export interface AccessGrant {
  email: string;
  name?: string | null;
  roles: Role[];
  active: boolean;
  grantedBy?: { uid: string; name: string };
  grantedAt: IsoTimestamp;
  claimedByUid?: string;
}

/** 學生文件上的再犯視窗快取（交易計數用） */
export interface RecidivismWindowEntry {
  infractionId: string;
  occurredOn: SchoolDate;
}

export interface SystemSettings {
  /** 再犯偵測回溯天數（含當天）— 預設 15 */
  recidivismWindowDays: number;
  /** 觸發門檻次數 — 預設 3 */
  recidivismThreshold: number;
  /** 安全觀察員值勤節數 — 預設 5 */
  observerPeriods: number;
  /** 管制節次清單（扣除打掃與 5 分鐘短下課） */
  observerPeriodNumbers: number[];
  /** 時區，一律 Asia/Taipei */
  timezone: string;
  /** 未回收紙本卡時，管制是否延續到隔日 */
  carryOverUnfinished: boolean;
  /** 公開唯讀看板設定 */
  publicBoard: {
    /** 是否對外公開（關閉時公開頁顯示「未開放」） */
    enabled: boolean;
    /**
     * 是否在公開頁列出個別學生（僅班級＋座號，絕不含姓名）。
     * 預設 false：公開頁只顯示統計數字。
     * 開啟前請確認符合校內個資規範 —— 校內同學可由班級座號辨識當事人。
     */
    showRoster: boolean;
  };
}

export const DEFAULT_SETTINGS: SystemSettings = {
  recidivismWindowDays: 15,
  recidivismThreshold: 3,
  observerPeriods: 5,
  observerPeriodNumbers: [1, 2, 3, 4, 5],
  timezone: 'Asia/Taipei',
  carryOverUnfinished: true,
  publicBoard: { enabled: true, showRoster: false },
};

/* ------------------------------------------------------------------ *
 * 公開唯讀看板（唯一允許匿名讀取的文件）
 * ------------------------------------------------------------------ */

export interface PublicBoard {
  date: SchoolDate;
  updatedAt: IsoTimestamp;
  /** 統計數字（永遠提供） */
  stats: {
    restrictedCount: number;
    openAlerts: number;
    observersToday: number;
    infractionsToday: number;
    infractions14d: number;
  };
  trend: Array<{ date: SchoolDate; safety: number; kindWords: number }>;
  hotspots: Array<{ name: string; count: number }>;
  /** 僅在 settings.publicBoard.showRoster = true 時提供；班級＋座號，無姓名 */
  roster?: Array<{
    className: string;
    seatNo: number | null;
    reasons: RestrictionReason[];
  }>;
  observers?: Array<{
    className: string;
    seatNo: number | null;
    periodsDone: number;
    totalPeriods: number;
  }>;
}
