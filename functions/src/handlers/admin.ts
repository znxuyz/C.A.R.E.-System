/**
 * 帳號與角色管理（僅 ADMIN 可呼叫）
 *
 * 角色以 Firebase Auth custom claims 儲存，讓安全規則可直接引用
 * `request.auth.token.roles`，不必每次讀取 Firestore（省讀取成本）。
 */
import { onCall } from 'firebase-functions/v2/https';
import { COLLECTIONS, col } from '../data/collections.js';
import { ROLES, type Role } from '../domain/types.js';
import { auth, db } from '../lib/firebase.js';
import { systemClock } from '../lib/clock.js';
import { writeAuditLog } from '../data/repositories.js';
import { requireRole, toHttpsError } from './auth.js';

const OPTS = { region: 'asia-east1' as const, cors: true };
const VALID_ROLES = new Set<string>(Object.values(ROLES));

/** 指派角色（生教組 / 導師 / 糾察隊 / 學生） */
export const setUserRoles = onCall(OPTS, async (request) => {
  const caller = requireRole(request, ROLES.ADMIN);
  try {
    const uid = String(request.data?.uid ?? '');
    const roles = (request.data?.roles ?? []) as Role[];
    const studentId = request.data?.studentId as string | undefined;
    const invalidRole = roles.find((role) => !VALID_ROLES.has(role));
    if (!uid || invalidRole) {
      throw new Error(invalidRole ? `未知角色 ${invalidRole}` : '缺少 uid');
    }

    await auth().setCustomUserClaims(uid, { roles, ...(studentId ? { studentId } : {}) });

    const firestore = db();
    const now = systemClock.now();
    if (!roles.includes(ROLES.STUDENT)) {
      await col(firestore, COLLECTIONS.staff).doc(uid).set(
        { roles, active: true, updatedAt: now },
        { merge: true },
      );
    }
    await writeAuditLog(firestore, {
      actorUid: caller.uid,
      actorName: caller.name,
      action: 'SET_USER_ROLES',
      entityType: 'auth',
      entityId: uid,
      after: { roles, studentId },
      at: now,
    });
    return { ok: true, uid, roles };
  } catch (error) {
    throw toHttpsError(error);
  }
});

/** 註冊 / 更新推播 token（登入後由前端呼叫；任何已登入者皆可為自己註冊） */
export const registerPushToken = onCall(OPTS, async (request) => {
  const caller = requireRole(
    request,
    ROLES.STUDENT,
    ROLES.HOMEROOM_TEACHER,
    ROLES.DISCIPLINE_STAFF,
    ROLES.PATROL,
  );
  try {
    const token = String(request.data?.token ?? '');
    if (!token) throw new Error('缺少推播 token');
    const firestore = db();
    const isStudent = caller.roles.includes(ROLES.STUDENT);
    const docId = isStudent ? (caller.studentId ?? caller.uid) : caller.uid;
    const collection = isStudent ? COLLECTIONS.students : COLLECTIONS.staff;
    const ref = col(firestore, collection).doc(docId);
    const snap = await ref.get();
    const tokens = new Set<string>((snap.get('fcmTokens') as string[] | undefined) ?? []);
    tokens.add(token);
    await ref.set({ fcmTokens: [...tokens], updatedAt: systemClock.now() }, { merge: true });
    return { ok: true };
  } catch (error) {
    throw toHttpsError(error);
  }
});
