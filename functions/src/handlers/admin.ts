/**
 * 帳號與設定管理（僅 ADMIN 可呼叫）
 *
 * 單人系統：通常只需在導入時指派一次角色給生活教育組長。
 */
import { onCall } from 'firebase-functions/v2/https';
import { COLLECTIONS, SETTINGS_DOC_ID, col } from '../data/collections.js';
import { writeAuditLog } from '../data/repositories.js';
import { ROLES, type Role } from '../domain/types.js';
import { systemClock } from '../lib/clock.js';
import { auth, db } from '../lib/firebase.js';
import { rebuildPublicBoard } from '../services/publicBoardService.js';
import { requireAdmin, toHttpsError } from './auth.js';

const OPTS = { region: 'asia-east1' as const, cors: true };
const VALID_ROLES = new Set<string>(Object.values(ROLES));

/** 指派角色（DISCIPLINE_STAFF / ADMIN） */
export const setUserRoles = onCall(OPTS, async (request) => {
  const caller = requireAdmin(request);
  try {
    const uid = String(request.data?.uid ?? '');
    const roles = (request.data?.roles ?? []) as Role[];
    const invalidRole = roles.find((role) => !VALID_ROLES.has(role));
    if (!uid || invalidRole) {
      throw new Error(invalidRole ? `未知角色 ${invalidRole}` : '缺少 uid');
    }

    await auth().setCustomUserClaims(uid, { roles });

    const firestore = db();
    const now = systemClock.now();
    await col(firestore, COLLECTIONS.staff)
      .doc(uid)
      .set({ roles, active: true, updatedAt: now }, { merge: true });
    await writeAuditLog(firestore, {
      actorUid: caller.uid,
      actorName: caller.name,
      action: 'SET_USER_ROLES',
      entityType: 'auth',
      entityId: uid,
      after: { roles },
      at: now,
    });
    return { ok: true, uid, roles };
  } catch (error) {
    throw toHttpsError(error);
  }
});

/** 更新系統設定（門檻、視窗、公開看板） */
export const updateSettings = onCall(OPTS, async (request) => {
  const caller = requireAdmin(request);
  try {
    const patch: Record<string, unknown> = {};
    const data = request.data ?? {};
    if (Number.isInteger(data.recidivismWindowDays)) {
      patch.recidivismWindowDays = data.recidivismWindowDays;
    }
    if (Number.isInteger(data.recidivismThreshold)) {
      patch.recidivismThreshold = data.recidivismThreshold;
    }
    if (typeof data.carryOverUnfinished === 'boolean') {
      patch.carryOverUnfinished = data.carryOverUnfinished;
    }
    if (typeof data.emailHomeroom === 'boolean') patch.emailHomeroom = data.emailHomeroom;
    if (data.publicBoard && typeof data.publicBoard === 'object') {
      patch.publicBoard = {
        enabled: Boolean(data.publicBoard.enabled),
        showRoster: Boolean(data.publicBoard.showRoster),
      };
    }
    if (Object.keys(patch).length === 0) throw new Error('沒有可更新的設定欄位');

    const firestore = db();
    const now = systemClock.now();
    await col(firestore, COLLECTIONS.settings)
      .doc(SETTINGS_DOC_ID)
      .set({ ...patch, updatedAt: now }, { merge: true });
    await writeAuditLog(firestore, {
      actorUid: caller.uid,
      actorName: caller.name,
      action: 'SETTINGS_UPDATED',
      entityType: COLLECTIONS.settings,
      entityId: SETTINGS_DOC_ID,
      after: patch,
      at: now,
    });
    await rebuildPublicBoard(firestore, systemClock);
    return { ok: true, patch };
  } catch (error) {
    throw toHttpsError(error);
  }
});
