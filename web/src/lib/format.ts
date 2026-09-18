import type {
  AlertStatus,
  AssignmentStatus,
  InfractionStatus,
  PaperCard,
  RestrictionReason,
} from './types.ts';

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
  return new Intl.DateTimeFormat('zh-TW', { timeZone: TZ, month: 'numeric', day: 'numeric' }).format(
    new Date(value),
  );
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
  ['日', '一', '二', '三', '四', '五', '六'][new Date(`${date}T00:00:00+08:00`).getDay()] ?? '';

export const INFRACTION_STATUS_LABEL: Record<InfractionStatus, string> = {
  OPEN: '待回收反思卡',
  DONE: '已回收・已解除',
  EXEMPTED: '免記',
  VOIDED: '已撤銷',
};

export const INFRACTION_STATUS_TONE: Record<InfractionStatus, string> = {
  OPEN: 'warning',
  DONE: 'good',
  EXEMPTED: 'neutral',
  VOIDED: 'neutral',
};

export const PAPER_CARD_LABEL: Record<PaperCard, string> = {
  SAFETY: '校園安全反思卡',
  KIND_WORDS: '口說好話反思卡',
};

export const PAPER_CARD_TONE: Record<PaperCard, string> = {
  SAFETY: 'safety',
  KIND_WORDS: 'words',
};

export const RESTRICTION_REASON_LABEL: Record<RestrictionReason, string> = {
  INFRACTION_PAPER: '待回收反思卡',
  OBSERVER_DUTY: '安全觀察員值勤',
  OBSERVER_REVIEW_PENDING: '待回收檢討書',
};

export const ASSIGNMENT_STATUS_LABEL: Record<AssignmentStatus, string> = {
  SCHEDULED: '已排定',
  IN_PROGRESS: '值勤中',
  DUTY_COMPLETED: '待回收檢討書',
  CLOSED: '已結案',
  CANCELLED: '已取消',
};

export const ASSIGNMENT_STATUS_TONE: Record<AssignmentStatus, string> = {
  SCHEDULED: 'warning',
  IN_PROGRESS: 'serious',
  DUTY_COMPLETED: 'serious',
  CLOSED: 'good',
  CANCELLED: 'neutral',
};

export const ALERT_STATUS_LABEL: Record<AlertStatus, string> = {
  OPEN: '待處理',
  ACKNOWLEDGED: '已確認',
  ASSIGNED: '已派安全觀察員',
  CLOSED: '已結案',
  DISMISSED: '已撤銷',
};

export const ALERT_STATUS_TONE: Record<AlertStatus, string> = {
  OPEN: 'critical',
  ACKNOWLEDGED: 'warning',
  ASSIGNED: 'serious',
  CLOSED: 'good',
  DISMISSED: 'neutral',
};
