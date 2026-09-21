/**
 * Firestore 集合定義
 *
 * 命名原則：collection 用複數 camelCase；文件 ID 盡量採用「自然鍵」以天然去重：
 *  - recessRestrictions/{studentId}_{YYYY-MM-DD}  → 每生每日僅一筆下課管制帳
 *  - schoolCalendar/{YYYY-MM-DD}                  → 校曆
 *  - infractionTypes/{TYPE_CODE}
 *  - settings/system                              → 全域參數（15 天 / 3 次 / 5 節）
 *  - publicBoard/today                            → 去識別化公開看板（唯一可匿名讀取）
 */
import type { CollectionReference, DocumentData, Firestore } from 'firebase-admin/firestore';
import type { SchoolDate } from '../domain/types.js';

export const COLLECTIONS = {
  /** 學生主檔 */
  students: 'students',
  /** 班級（可選填導師姓名與信箱） */
  classes: 'classes',
  /** 教職員與角色（單人系統通常只有 1–2 筆） */
  staff: 'staff',
  /** 以 Google 信箱預先授權的名單（僅 Cloud Functions 可存取） */
  accessGrants: 'accessGrants',
  /** 違規類型設定（走廊奔跑、口出穢言…） */
  infractionTypes: 'infractionTypes',
  /** 校園地點（走廊、樓梯、川堂…） */
  locations: 'locations',
  /** 違規事件（再犯計數的唯一來源） */
  infractions: 'infractions',
  /** 下課管制每日帳 */
  recessRestrictions: 'recessRestrictions',
  /** 再犯警示 */
  recidivismAlerts: 'recidivismAlerts',
  /** 安全觀察員派單 */
  observerAssignments: 'observerAssignments',
  /** 公開唯讀看板（去識別化） */
  publicBoard: 'publicBoard',
  /** Firebase「Trigger Email」擴充套件監看的寄信佇列（選用） */
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
export const PUBLIC_BOARD_DOC_ID = 'today';

/** 下課管制帳的自然鍵：每生每日一筆 */
export function restrictionId(studentId: string, date: SchoolDate): string {
  return `${studentId}_${date}`;
}

export function col(firestore: Firestore, name: CollectionName): CollectionReference<DocumentData> {
  return firestore.collection(name);
}
