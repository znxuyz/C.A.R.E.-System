/**
 * 服務層共用情境
 *
 * 免費方案架構下，所有業務邏輯都在前端執行，因此每個服務都需要：
 *  - `db`：Firestore 實例
 *  - `actor`：目前登入者（寫入稽核軌跡、以及規則會比對 recordedBy.uid）
 *  - `clock`：時間來源（測試可注入固定時間）
 *
 * 時間戳一律以 ISO-8601 字串儲存，並由安全規則要求等於 `request.time`，
 * 因此即使寫入端在前端，時間仍無法造假。
 */
import { serverTimestamp, type Firestore } from 'firebase/firestore';
import { todayInTaipei } from '../domain/dates.js';
import type { IsoTimestamp, SchoolDate } from '../domain/types.js';

export interface Actor {
  uid: string;
  name: string;
  email?: string;
}

export interface Clock {
  now(): IsoTimestamp;
  today(): SchoolDate;
}

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
  today: () => todayInTaipei(new Date()),
};

export interface Ctx {
  db: Firestore;
  actor: Actor;
  clock: Clock;
}

/** 稽核軌跡（僅可新增，不可修改或刪除；由安全規則保證） */
export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

export function auditDoc(ctx: Ctx, entry: AuditEntry) {
  return {
    actorUid: ctx.actor.uid,
    actorName: ctx.actor.name,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    before: entry.before ?? null,
    after: entry.after ?? null,
    // 規則要求 createdAt == request.time：時間由伺服器決定，前端無法竄改
    createdAt: serverTimestamp(),
  };
}
