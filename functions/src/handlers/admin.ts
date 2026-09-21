/**
 * 帳號授權與系統設定
 *
 * 登入方式：**Google 帳號**（建議使用學校 Google Workspace 網域）。
 *
 * 授權流程（避免「先有雞還是先有蛋」）：
 *   1. 部署時於 functions/.env 設定 `ADMIN_EMAILS`（可多筆，逗號分隔）。
 *   2. 管理者用 Google 登入後，前端自動呼叫 `claimAccess()`；
 *      信箱在 ADMIN_EMAILS 內 → 取得 ADMIN 角色。
 *   3. 管理者在「帳號管理」輸入生教組長的 Google 信箱並指派角色 →
 *      `grantAccess()` 寫入 `accessGrants/{email}`（即使對方尚未登入過也可預先授權）。
 *   4. 生教組長用 Google 登入後，`claimAccess()` 依該筆授權寫入 custom claims。
 *
 * 角色一律存於 Firebase Auth custom claims，安全規則直接引用 `request.auth.token.roles`。
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { COLLECTIONS, SETTINGS_DOC_ID, col } from '../data/collections.js';
import { loadSettings, writeAuditLog } from '../data/repositories.js';
import { DEFAULT_SETTINGS, ROLES, type Role } from '../domain/types.js';
import { systemClock } from '../lib/clock.js';
import { auth, db } from '../lib/firebase.js';
import { rebuildPublicBoard } from '../services/publicBoardService.js';
import { requireAdmin, toHttpsError } from './auth.js';

const OPTS = { region: 'asia-east1' as const, cors: true };
const VALID_ROLES = new Set<string>(Object.values(ROLES));

/**
 * 系統管理者信箱白名單（逗號分隔）。
 * 設定於 functions/.env（或部署時的環境變數）：
 *   ADMIN_EMAILS="principal@example.edu.tw,it@example.edu.tw"
 */
const ADMIN_EMAILS = defineString('ADMIN_EMAILS', { default: '' });

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

function bootstrapAdminEmails(): string[] {
  return ADMIN_EMAILS.value()
    .split(',')
    .map(normalizeEmail)
    .filter(Boolean);
}

function parseRoles(input: unknown): Role[] {
  const roles = (Array.isArray(input) ? input : []) as Role[];
  const invalid = roles.find((role) => !VALID_ROLES.has(role));
  if (invalid) throw new HttpsError('invalid-argument', `未知角色 ${invalid}`);
  if (roles.length === 0) throw new HttpsError('invalid-argument', '請至少指派一個角色');
  return [...new Set(roles)];
}

/** 取得已登入使用者（不要求角色，供 claimAccess 使用） */
function requireSignedIn(request: CallableRequest): {
  uid: string;
  email: string;
  name: string;
  emailVerified: boolean;
} {
  const authData = request.auth;
  if (!authData) throw new HttpsError('unauthenticated', '請先登入');
  const claims = authData.token as Record<string, unknown>;
  const email = normalizeEmail(String(claims.email ?? ''));
  if (!email) throw new HttpsError('failed-precondition', '此登入方式未提供 Email，無法比對授權');
  return {
    uid: authData.uid,
    email,
    name: (claims.name as string) ?? email,
    emailVerified: Boolean(claims.email_verified),
  };
}

/* ------------------------------------------------------------------ *
 * 1. 領取授權（登入後由前端自動呼叫）
 * ------------------------------------------------------------------ */

export const claimAccess = onCall(OPTS, async (request) => {
  const caller = requireSignedIn(request);
  try {
    // Google 帳號一律為已驗證信箱；其他情況拒絕，避免冒用他人信箱領取授權
    if (!caller.emailVerified) {
      throw new HttpsError('permission-denied', '請使用已驗證的 Google 帳號登入');
    }

    const firestore = db();
    const now = systemClock.now();
    let roles: Role[] | null = null;
    let source = '';

    if (bootstrapAdminEmails().includes(caller.email)) {
      roles = [ROLES.ADMIN, ROLES.DISCIPLINE_STAFF];
      source = 'ADMIN_EMAILS';
    } else {
      const grantSnap = await col(firestore, COLLECTIONS.accessGrants).doc(caller.email).get();
      if (grantSnap.exists && grantSnap.get('active') !== false) {
        roles = (grantSnap.get('roles') as Role[]) ?? null;
        source = 'accessGrants';
      }
    }

    if (!roles || roles.length === 0) {
      return { granted: false, roles: [] as Role[] };
    }

    await auth().setCustomUserClaims(caller.uid, { roles });
    await col(firestore, COLLECTIONS.staff).doc(caller.uid).set(
      {
        uid: caller.uid,
        email: caller.email,
        name: caller.name,
        roles,
        active: true,
        lastClaimedAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
    // 標記授權已被領取，方便管理者在帳號管理頁確認對方是否已登入過
    await col(firestore, COLLECTIONS.accessGrants)
      .doc(caller.email)
      .set({ claimedByUid: caller.uid, claimedAt: now }, { merge: true });

    await writeAuditLog(firestore, {
      actorUid: caller.uid,
      actorName: caller.name,
      action: 'ACCESS_CLAIMED',
      entityType: 'auth',
      entityId: caller.uid,
      after: { email: caller.email, roles, source },
      at: now,
    });

    return { granted: true, roles };
  } catch (error) {
    throw toHttpsError(error);
  }
});

/* ------------------------------------------------------------------ *
 * 2. 指派 / 取消授權（僅 ADMIN）
 * ------------------------------------------------------------------ */

/** 以 Google 信箱預先授權；對方已登入過則立即生效 */
export const grantAccess = onCall(OPTS, async (request) => {
  const caller = requireAdmin(request);
  try {
    const email = normalizeEmail(String(request.data?.email ?? ''));
    if (!email.includes('@')) throw new HttpsError('invalid-argument', '請輸入有效的 Google 信箱');
    const roles = parseRoles(request.data?.roles);
    const displayName = String(request.data?.name ?? '').trim();

    const firestore = db();
    const now = systemClock.now();

    await col(firestore, COLLECTIONS.accessGrants).doc(email).set(
      {
        email,
        name: displayName || null,
        roles,
        active: true,
        grantedBy: { uid: caller.uid, name: caller.name },
        grantedAt: now,
        updatedAt: now,
      },
      { merge: true },
    );

    // 對方若已用 Google 登入過，直接套用 claims（免再登出入一次）
    let appliedImmediately = false;
    try {
      const user = await auth().getUserByEmail(email);
      await auth().setCustomUserClaims(user.uid, { roles });
      await col(firestore, COLLECTIONS.staff).doc(user.uid).set(
        {
          uid: user.uid,
          email,
          name: displayName || user.displayName || email,
          roles,
          active: true,
          updatedAt: now,
        },
        { merge: true },
      );
      appliedImmediately = true;
    } catch {
      // 對方尚未登入過 → 授權先存著，待其首次登入時由 claimAccess 套用
    }

    await writeAuditLog(firestore, {
      actorUid: caller.uid,
      actorName: caller.name,
      action: 'ACCESS_GRANTED',
      entityType: 'accessGrants',
      entityId: email,
      after: { roles, appliedImmediately },
      at: now,
    });

    return { ok: true, email, roles, appliedImmediately };
  } catch (error) {
    throw toHttpsError(error);
  }
});

/** 取消授權：清除 custom claims 並停用 staff 與授權紀錄 */
export const revokeAccess = onCall(OPTS, async (request) => {
  const caller = requireAdmin(request);
  try {
    const email = normalizeEmail(String(request.data?.email ?? ''));
    if (!email) throw new HttpsError('invalid-argument', '缺少 email');
    if (email === normalizeEmail(caller.email ?? '')) {
      throw new HttpsError('failed-precondition', '不可取消自己的授權');
    }
    if (bootstrapAdminEmails().includes(email)) {
      throw new HttpsError(
        'failed-precondition',
        '此信箱列於部署設定 ADMIN_EMAILS，請先自該設定移除',
      );
    }

    const firestore = db();
    const now = systemClock.now();

    await col(firestore, COLLECTIONS.accessGrants)
      .doc(email)
      .set({ active: false, revokedBy: { uid: caller.uid, name: caller.name }, revokedAt: now }, { merge: true });

    try {
      const user = await auth().getUserByEmail(email);
      await auth().setCustomUserClaims(user.uid, { roles: [] });
      await auth().revokeRefreshTokens(user.uid); // 立即失效，不必等 token 過期
      await col(firestore, COLLECTIONS.staff)
        .doc(user.uid)
        .set({ roles: [], active: false, updatedAt: now }, { merge: true });
    } catch {
      // 對方從未登入過，只需停用授權紀錄
    }

    await writeAuditLog(firestore, {
      actorUid: caller.uid,
      actorName: caller.name,
      action: 'ACCESS_REVOKED',
      entityType: 'accessGrants',
      entityId: email,
      at: now,
    });

    return { ok: true };
  } catch (error) {
    throw toHttpsError(error);
  }
});

/** 帳號清單（含尚未登入過的預先授權） */
export const listAccess = onCall(OPTS, async (request) => {
  requireAdmin(request);
  try {
    const firestore = db();
    const [staffSnap, grantSnap] = await Promise.all([
      col(firestore, COLLECTIONS.staff).get(),
      col(firestore, COLLECTIONS.accessGrants).get(),
    ]);

    const byEmail = new Map<string, Record<string, unknown>>();
    for (const doc of grantSnap.docs) {
      byEmail.set(doc.id, {
        email: doc.id,
        name: doc.get('name') ?? null,
        roles: doc.get('roles') ?? [],
        active: doc.get('active') !== false,
        signedInBefore: Boolean(doc.get('claimedByUid')),
        grantedAt: doc.get('grantedAt') ?? null,
      });
    }
    for (const doc of staffSnap.docs) {
      const email = normalizeEmail(String(doc.get('email') ?? ''));
      if (!email) continue;
      byEmail.set(email, {
        ...(byEmail.get(email) ?? {}),
        email,
        uid: doc.id,
        name: doc.get('name') ?? byEmail.get(email)?.name ?? null,
        roles: doc.get('roles') ?? [],
        active: doc.get('active') !== false,
        signedInBefore: true,
      });
    }

    return {
      users: [...byEmail.values()],
      bootstrapAdmins: bootstrapAdminEmails(),
    };
  } catch (error) {
    throw toHttpsError(error);
  }
});

/* ------------------------------------------------------------------ *
 * 3. 系統設定（15 天 / 3 次 / 5 節等，由後台調整）
 * ------------------------------------------------------------------ */

const intInRange = (value: unknown, min: number, max: number, label: string): number => {
  const num = Number(value);
  if (!Number.isInteger(num) || num < min || num > max) {
    throw new HttpsError('invalid-argument', `${label} 須為 ${min}–${max} 的整數`);
  }
  return num;
};

export const updateSettings = onCall(OPTS, async (request) => {
  const caller = requireAdmin(request);
  try {
    const data = request.data ?? {};
    const patch: Record<string, unknown> = {};

    if (data.recidivismWindowDays !== undefined) {
      patch.recidivismWindowDays = intInRange(data.recidivismWindowDays, 1, 90, '回溯天數');
    }
    if (data.recidivismThreshold !== undefined) {
      patch.recidivismThreshold = intInRange(data.recidivismThreshold, 1, 20, '觸發次數');
    }
    if (data.observerPeriodNumbers !== undefined) {
      const periods = (Array.isArray(data.observerPeriodNumbers) ? data.observerPeriodNumbers : [])
        .map((value: unknown) => intInRange(value, 1, 12, '值勤節次'))
        .sort((a: number, b: number) => a - b);
      if (periods.length === 0) throw new HttpsError('invalid-argument', '請至少選擇一節值勤節次');
      patch.observerPeriodNumbers = [...new Set(periods)];
      // 節數與節次清單保持一致，避免值勤完成判定錯亂
      patch.observerPeriods = (patch.observerPeriodNumbers as number[]).length;
    } else if (data.observerPeriods !== undefined) {
      const count = intInRange(data.observerPeriods, 1, 12, '值勤節數');
      patch.observerPeriods = count;
      patch.observerPeriodNumbers = Array.from({ length: count }, (_, index) => index + 1);
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

    if (Object.keys(patch).length === 0) {
      throw new HttpsError('invalid-argument', '沒有可更新的設定欄位');
    }

    const firestore = db();
    const now = systemClock.now();
    const before = await loadSettings(firestore);

    await col(firestore, COLLECTIONS.settings)
      .doc(SETTINGS_DOC_ID)
      .set({ ...DEFAULT_SETTINGS, ...before, ...patch, updatedAt: now }, { merge: true });

    await writeAuditLog(firestore, {
      actorUid: caller.uid,
      actorName: caller.name,
      action: 'SETTINGS_UPDATED',
      entityType: COLLECTIONS.settings,
      entityId: SETTINGS_DOC_ID,
      before,
      after: patch,
      at: now,
    });

    await rebuildPublicBoard(firestore, systemClock);
    return { ok: true, settings: { ...before, ...patch } };
  } catch (error) {
    throw toHttpsError(error);
  }
});
