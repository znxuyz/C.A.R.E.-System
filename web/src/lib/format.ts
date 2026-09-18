import type { AssignmentStatus, CaseStatus, FormKind, RestrictionReason } from './types.ts';

const TZ = 'Asia/Taipei';

export const todayTaipei = (offsetDays = 0): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + offsetDays * 86400000));

export const formatDate = (iso?: string): string => {
  if (!iso) return '—';
  const value = iso.length === 10 ? `${iso}T00:00:00+08:00` : iso;
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: TZ,
    month: 'numeric',
    day: 'numeric',
  }).format(new Date(value));
};

export const formatDateTime = (iso?: string): string => {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: TZ,
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
};

export const weekdayLabel = (date: string): string =>
  ['日', '一', '二', '三', '四', '五', '六'][
    new Date(`${date}T00:00:00+08:00`).getDay()
  ] ?? '';

export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  DRAFT: '未填寫',
  PENDING_TEACHER: '待導師簽章',
  PENDING_OFFICE: '待生教組蓋章',
  COMPLETED: '已完成',
  RETURNED: '退回補正',
  EXEMPTED: '班級活動優先（不計處分）',
  VOIDED: '已撤銷',
};

export const CASE_STATUS_TONE: Record<CaseStatus, string> = {
  DRAFT: 'neutral',
  PENDING_TEACHER: 'warning',
  PENDING_OFFICE: 'serious',
  COMPLETED: 'good',
  RETURNED: 'critical',
  EXEMPTED: 'neutral',
  VOIDED: 'neutral',
};

export const FORM_KIND_LABEL: Record<FormKind, string> = {
  SAFETY_REFLECTION: '校園安全反思卡',
  KIND_WORDS_REFLECTION: '口說好話反思卡',
  CONDUCT_REVIEW: '行為檢討書',
};

export const FORM_KIND_TONE: Record<FormKind, string> = {
  SAFETY_REFLECTION: 'safety',
  KIND_WORDS_REFLECTION: 'words',
  CONDUCT_REVIEW: 'neutral',
};

export const RESTRICTION_REASON_LABEL: Record<RestrictionReason, string> = {
  INFRACTION_REFLECTION: '待完成反思卡',
  OBSERVER_DUTY: '安全觀察員值勤',
  OBSERVER_REVIEW_PENDING: '待檢討書審核',
};

export const ASSIGNMENT_STATUS_LABEL: Record<AssignmentStatus, string> = {
  SCHEDULED: '已排定',
  IN_PROGRESS: '值勤中',
  DUTY_COMPLETED: '值勤完成・待檢討書',
  REVIEW_PENDING: '檢討書審核中',
  CLOSED: '已結案',
  CANCELLED: '已取消',
};

export const ASSIGNMENT_STATUS_TONE: Record<AssignmentStatus, string> = {
  SCHEDULED: 'warning',
  IN_PROGRESS: 'serious',
  DUTY_COMPLETED: 'serious',
  REVIEW_PENDING: 'warning',
  CLOSED: 'good',
  CANCELLED: 'neutral',
};

export const ROLE_LABEL: Record<string, string> = {
  STUDENT: '學生',
  HOMEROOM_TEACHER: '班導師',
  DISCIPLINE_STAFF: '生教組',
  PATROL: '糾察隊',
  ADMIN: '系統管理者',
};
