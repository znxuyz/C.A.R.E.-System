/** 前端檢視模型（與 functions/src/domain/types.ts 對應之精簡版） */

export type Role = "DISCIPLINE_STAFF" | "ADMIN";
export type InfractionStatus = "OPEN" | "DONE" | "EXEMPTED" | "VOIDED";
export type PaperCard = "SAFETY" | "KIND_WORDS";
export type RestrictionReason =
  | "INFRACTION_PAPER"
  | "OBSERVER_DUTY"
  | "OBSERVER_REVIEW_PENDING";
export type AssignmentStatus =
  | "SCHEDULED"
  | "IN_PROGRESS"
  | "DUTY_COMPLETED"
  | "CLOSED"
  | "CANCELLED";
export type AlertStatus =
  | "OPEN"
  | "ACKNOWLEDGED"
  | "ASSIGNED"
  | "CLOSED"
  | "DISMISSED";

export interface Session {
  uid: string;
  name: string;
  roles: Role[];
  email?: string;
}

export interface InfractionTypeOption {
  code: string;
  name: string;
  paperCard: PaperCard;
  paperCardLabel: string;
  icon?: string;
  /** 是否計入再犯次數（後台可調；預設計入） */
  countsTowardRecidivism?: boolean;
  order?: number;
}

export interface LocationOption {
  code: string;
  name: string;
  isHotspot: boolean;
}

export interface InfractionRow {
  id: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  className: string;
  seatNo?: number;
  typeCode: string;
  typeName: string;
  paperCard: PaperCard;
  /** 登錄當下該類型的卡名（後台改名不影響歷史紀錄） */
  paperCardLabel?: string;
  occurredAt: string;
  occurredOn: string;
  periodNo: number;
  locationName: string;
  note?: string;
  status: InfractionStatus;
  paperReturnedOn?: string;
  exemptReason?: string;
  voidReason?: string;
  recordedBy?: { uid: string; name: string };
  /** 該筆登錄當下，15 天視窗內的累計次數（僅清單顯示用） */
  windowCount?: number;
}

export interface RestrictionRow {
  id: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  className: string;
  seatNo?: number;
  date: string;
  reasons: RestrictionReason[];
  status: "ACTIVE" | "LIFTED" | "CANCELLED";
  note?: string;
}

export interface AlertRow {
  id: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  className: string;
  triggeredAt: string;
  windowStart: string;
  windowEnd: string;
  windowDays: number;
  count: number;
  threshold: number;
  status: AlertStatus;
  assignmentId?: string;
  dutyOn?: string;
  breakdown: Array<{
    infractionId: string;
    typeName: string;
    occurredOn: string;
  }>;
}

export interface PeriodLogView {
  periodNo: number;
  checkInAt?: string;
  checkOutAt?: string;
  observedCount?: number;
  note?: string;
}

export interface AssignmentRow {
  id: string;
  alertId: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  className: string;
  dutyOn: string;
  status: AssignmentStatus;
  totalPeriods: number;
  periodLogs: PeriodLogView[];
  reviewReturnedOn?: string;
  unlockOn?: string;
}

export interface WatchlistRow {
  studentId: string;
  studentNo: string;
  studentName: string;
  className: string;
  count: number;
  shortfall: number;
}

export interface DashboardData {
  today: string;
  kpis: {
    restrictedActive: number;
    pendingPapers: number;
    openAlerts: number;
    observersToday: number;
    infractionsToday: number;
    watchlist: number;
  };
  restrictions: RestrictionRow[];
  pendingPapers: InfractionRow[];
  alerts: AlertRow[];
  assignments: AssignmentRow[];
  trend: Array<{ date: string; safety: number; kindWords: number }>;
  hotspots: Array<{ name: string; count: number }>;
  watchlist: WatchlistRow[];
}

export interface StudentDetail {
  id: string;
  studentNo: string;
  name: string;
  className: string;
  seatNo?: number;
  progress: {
    count: number;
    threshold: number;
    shortfall: number;
    windowStart: string;
    windowEnd: string;
  };
  totals: { infractions: number; alerts: number; duties: number };
  history: InfractionRow[];
  alerts: AlertRow[];
  restrictedToday: boolean;
}

/** 公開看板（去識別化；由後端產生，前端只讀這一份） */
export interface PublicBoardData {
  enabled: boolean;
  date: string;
  updatedAt: string;
  stats: {
    restrictedCount: number;
    openAlerts: number;
    observersToday: number;
    infractionsToday: number;
    infractions14d: number;
  };
  trend: Array<{ date: string; safety: number; kindWords: number }>;
  hotspots: Array<{ name: string; count: number }>;
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

/** 系統設定（後台可調） */
export interface SystemSettings {
  recidivismWindowDays: number;
  recidivismThreshold: number;
  observerPeriods: number;
  observerPeriodNumbers: number[];
  carryOverUnfinished: boolean;
  publicBoard: { enabled: boolean; showRoster: boolean };
}

/** 帳號授權清單的一列 */
export interface AccessUser {
  email: string;
  uid?: string;
  name?: string | null;
  roles: Role[];
  active: boolean;
  /** 是否已用 Google 登入過（未登入者為預先授權） */
  signedInBefore: boolean;
  grantedAt?: string | null;
}

export interface CreateInfractionInput {
  studentNo: string;
  typeCode: string;
  locationCode: string;
  periodNo: number;
  note?: string;
}
