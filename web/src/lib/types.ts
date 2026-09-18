/** 前端檢視模型（與 functions/src/domain/types.ts 對應之精簡版） */

export type Role = 'STUDENT' | 'HOMEROOM_TEACHER' | 'DISCIPLINE_STAFF' | 'PATROL' | 'ADMIN';

export type CaseStatus =
  | 'DRAFT'
  | 'PENDING_TEACHER'
  | 'PENDING_OFFICE'
  | 'COMPLETED'
  | 'RETURNED'
  | 'EXEMPTED'
  | 'VOIDED';

export type FormKind = 'SAFETY_REFLECTION' | 'KIND_WORDS_REFLECTION' | 'CONDUCT_REVIEW';

export type RestrictionReason =
  | 'INFRACTION_REFLECTION'
  | 'OBSERVER_DUTY'
  | 'OBSERVER_REVIEW_PENDING';

export type AssignmentStatus =
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'DUTY_COMPLETED'
  | 'REVIEW_PENDING'
  | 'CLOSED'
  | 'CANCELLED';

export interface Session {
  uid: string;
  name: string;
  roles: Role[];
  studentId?: string;
  email?: string;
}

export interface InfractionTypeOption {
  code: string;
  name: string;
  formKind: FormKind;
  formTitle: string;
  hint: string;
}

export interface LocationOption {
  code: string;
  name: string;
  isHotspot: boolean;
}

export interface ApprovalView {
  stage: 'HOMEROOM_TEACHER' | 'DISCIPLINE_OFFICE';
  decision: 'SIGNED' | 'RETURNED' | 'EXEMPTED';
  actorName: string;
  comment?: string;
  actedAt: string;
}

export interface CardSummary {
  id: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  className: string;
  typeName: string;
  formKind: FormKind;
  formTitle: string;
  status: CaseStatus;
  countOn: string;
  submittedAt?: string;
  teacherSignedAt?: string;
  teacherName?: string;
  returnCount: number;
  /** 累犯進度（此卡計入後，15 天視窗內的張數） */
  windowCardCount?: number;
}

export interface FormQuestion {
  id: string;
  type: 'text' | 'textarea' | 'choice' | 'multiselect' | 'scale' | 'number';
  label: string;
  required?: boolean;
  minLength?: number;
  placeholder?: string;
  options?: string[];
  min?: number;
  max?: number;
}

export interface FormSection {
  id: string;
  title: string;
  questions: FormQuestion[];
}

export interface FormTemplate {
  id: string;
  title: string;
  subtitle?: string;
  guidance: string;
  sections: FormSection[];
}

export interface CardDetail extends CardSummary {
  template: FormTemplate;
  answers: Record<string, unknown>;
  approvals: ApprovalView[];
  infraction: {
    id: string;
    typeName: string;
    occurredAt: string;
    periodNo: number;
    locationName: string;
    description?: string;
    reporterName: string;
    reporterRole: Role;
  };
  progress: {
    cardCount: number;
    threshold: number;
    shortfall: number;
    windowStart: string;
    windowEnd: string;
  };
}

export interface RestrictionRow {
  id: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  className: string;
  date: string;
  reasons: RestrictionReason[];
  status: 'ACTIVE' | 'LIFTED' | 'CANCELLED';
  note?: string;
  allowWaterAndRestroom: true;
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
  cardCount: number;
  threshold: number;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'ASSIGNED' | 'CLOSED' | 'DISMISSED';
  assignmentId?: string;
  dutyOn?: string;
  breakdown: Array<{ cardId: string; formKind: FormKind; countOn: string }>;
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
  studentId: string;
  studentNo: string;
  studentName: string;
  className: string;
  dutyOn: string;
  status: AssignmentStatus;
  totalPeriods: number;
  periodLogs: PeriodLogView[];
  conductReviewId?: string;
  conductReviewStatus?: CaseStatus;
  unlockOn?: string;
}

export interface DashboardData {
  today: string;
  kpis: {
    restrictedActive: number;
    pendingOffice: number;
    pendingTeacher: number;
    openAlerts: number;
    observersToday: number;
    atRiskStudents: number;
  };
  restrictions: RestrictionRow[];
  officeQueue: CardSummary[];
  alerts: AlertRow[];
  assignments: AssignmentRow[];
  /** 近 14 天每日反思卡張數（分卡種） */
  trend: Array<{ date: string; safety: number; words: number }>;
  /** 違規熱點 Top N */
  hotspots: Array<{ name: string; count: number }>;
}

export interface StudentTimelineItem {
  id: string;
  kind: 'INFRACTION' | 'CARD' | 'ALERT' | 'DUTY' | 'REVIEW';
  title: string;
  detail: string;
  at: string;
  status?: string;
}

export interface StudentDetail {
  id: string;
  studentNo: string;
  name: string;
  className: string;
  guardianEmail?: string;
  progress: {
    cardCount: number;
    threshold: number;
    shortfall: number;
    windowStart: string;
    windowEnd: string;
  };
  totals: { infractions: number; cards: number; alerts: number; duties: number };
  timeline: StudentTimelineItem[];
  restrictedToday: boolean;
}

export interface CreateInfractionInput {
  studentNo: string;
  typeCode: string;
  locationCode: string;
  periodNo: number;
  occurredAt?: string;
  locationDetail?: string;
  description?: string;
}

export interface ReviewInput {
  cardId: string;
  decision: 'SIGNED' | 'RETURNED';
  comment?: string;
  teacherActivityPriority?: boolean;
  exemptReason?: string;
}
