/**
 * Firestore 集合定義
 *
 * 命名原則：collection 用複數 camelCase；文件 ID 盡量採用「自然鍵」以天然去重：
 *  - recessRestrictions/{studentId}_{YYYY-MM-DD}  → 每生每日僅一筆下課管制帳
 *  - schoolCalendar/{YYYY-MM-DD}                  → 校曆
 *  - infractionTypes/{TYPE_CODE}、formTemplates/{TEMPLATE_ID}
 *  - settings/system                              → 全域參數（15 天 / 3 張 / 5 節）
 */
import type {
  CollectionReference,
  DocumentData,
  Firestore,
  Query,
} from 'firebase-admin/firestore';
import type { SchoolDate } from '../domain/types.js';

export const COLLECTIONS = {
  /** 學生主檔 */
  students: 'students',
  /** 班級（含導師 uid） */
  classes: 'classes',
  /** 教職員（生教組 / 導師 / 糾察隊）＋ FCM token */
  staff: 'staff',
  /** 違規類型設定（走廊奔跑、口出穢言…） */
  infractionTypes: 'infractionTypes',
  /** 表單模板（校園安全反思卡 / 口說好話反思卡 / 行為檢討書） */
  formTemplates: 'formTemplates',
  /** 校園地點（走廊、樓梯、川堂…） */
  locations: 'locations',
  /** 違規事件 */
  infractions: 'infractions',
  /** 反思卡 */
  reflectionCards: 'reflectionCards',
  /** 下課管制每日帳 */
  recessRestrictions: 'recessRestrictions',
  /** 累犯警示 */
  recidivismAlerts: 'recidivismAlerts',
  /** 安全觀察員派單 */
  observerAssignments: 'observerAssignments',
  /** 行為檢討書 */
  conductReviews: 'conductReviews',
  /** 系統通知紀錄（推播） */
  notifications: 'notifications',
  /** Firebase「Trigger Email」擴充套件監看的寄信佇列 */
  mail: 'mail',
  /** 稽核軌跡 */
  auditLogs: 'auditLogs',
  /** 校曆 */
  schoolCalendar: 'schoolCalendar',
  /** 系統設定 */
  settings: 'settings',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

export const SETTINGS_DOC_ID = 'system';

/** 下課管制帳的自然鍵：每生每日一筆 */
export function restrictionId(studentId: string, date: SchoolDate): string {
  return `${studentId}_${date}`;
}

export function col(firestore: Firestore, name: CollectionName): CollectionReference<DocumentData> {
  return firestore.collection(name);
}

/** 型別化查詢輔助（Admin SDK 的 Query 泛型較鬆，集中一處便於調整） */
export type Q = Query<DocumentData>;
