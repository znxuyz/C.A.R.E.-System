/**
 * Firestore 集合與文件路徑
 *
 * 文件 ID 盡量採自然鍵，讓「同一件事只會有一筆」：
 *  - recessRestrictions/{studentId}_{YYYY-MM-DD}  每生每日一筆管制帳
 *  - accessGrants/{email}                         每個信箱一筆授權
 *  - staff/{uid}                                  角色的真實來源
 *  - publicBoard/today                            去識別化公開摘要
 */
export const COL = {
  students: 'students',
  classes: 'classes',
  staff: 'staff',
  accessGrants: 'accessGrants',
  infractionTypes: 'infractionTypes',
  locations: 'locations',
  infractions: 'infractions',
  recessRestrictions: 'recessRestrictions',
  recidivismAlerts: 'recidivismAlerts',
  observerAssignments: 'observerAssignments',
  publicBoard: 'publicBoard',
  auditLogs: 'auditLogs',
  schoolCalendar: 'schoolCalendar',
  settings: 'settings',
} as const;

export const SETTINGS_DOC = 'system';
export const PUBLIC_BOARD_DOC = 'today';

export const restrictionId = (studentId: string, date: string): string =>
  `${studentId}_${date}`;
