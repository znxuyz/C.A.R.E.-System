/**
 * 帳號授權（免 Cloud Functions 版本）
 *
 * 角色的真實來源是 `staff/{uid}.roles`，安全規則以 get() 讀取它判定權限。
 * 授權流程：
 *   1. 匯入初始資料時，seed 指令依 `ADMIN_EMAILS` 建立管理者的 accessGrants。
 *   2. 使用者以 Google 登入 → 前端讀「自己那一筆」授權（規則只允許讀自己的）
 *      → 建立 `staff/{uid}`，規則會驗證 roles 必須與授權一致，無法自行提權。
 *   3. 管理者於「帳號管理」新增/停用授權（規則僅允許 ADMIN 寫入 accessGrants）。
 *
 * 取消授權會即時生效：規則每次請求都會重新讀取 staff 文件，
 * 不像 custom claims 需等待 token 過期。
 */
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { COL } from '../firestore/paths.js';
import { ROLES, type Role } from '../domain/types.js';
import { auditDoc, type Ctx } from './context.js';

const VALID_ROLES = new Set<string>(Object.values(ROLES));
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export interface AccessUserRow {
  email: string;
  uid?: string;
  name?: string | null;
  roles: Role[];
  active: boolean;
  signedInBefore: boolean;
}

/**
 * 登入後領取授權：讀自己的 staff 文件；若無角色，再讀自己的 accessGrants。
 * 回傳最終角色（空陣列代表尚未被授權）。
 */
export async function claimAccess(
  db: Firestore,
  user: { uid: string; email: string; name: string },
): Promise<Role[]> {
  const email = normalizeEmail(user.email);
  const staffRef = doc(db, COL.staff, user.uid);
  const staffSnap = await getDoc(staffRef);

  if (staffSnap.exists() && staffSnap.get('active') !== false) {
    const roles = (staffSnap.get('roles') as Role[]) ?? [];
    if (roles.length > 0) return roles;
  }

  const grantSnap = await getDoc(doc(db, COL.accessGrants, email));
  if (!grantSnap.exists() || grantSnap.get('active') === false) return [];
  const roles = ((grantSnap.get('roles') as Role[]) ?? []).filter((role) => VALID_ROLES.has(role));
  if (roles.length === 0) return [];

  // 規則會驗證 roles 必須等於授權內容、email 必須等於登入信箱
  await setDoc(
    staffRef,
    {
      uid: user.uid,
      email,
      name: user.name,
      roles,
      active: true,
      updatedAt: serverTimestamp(),
      createdAt: staffSnap.exists() ? staffSnap.get('createdAt') : serverTimestamp(),
    },
    { merge: true },
  );
  await updateDoc(doc(db, COL.accessGrants, email), {
    claimedByUid: user.uid,
    claimedAt: serverTimestamp(),
  }).catch(() => {
    /* 非管理者無法寫入授權文件，領取仍算成功 */
  });

  return roles;
}

/** 以 Google 信箱授權（僅管理者；對方不需事先註冊） */
export async function grantAccess(
  ctx: Ctx,
  params: { email: string; roles: Role[]; name?: string },
): Promise<{ email: string; roles: Role[] }> {
  const email = normalizeEmail(params.email);
  if (!email.includes('@')) throw new Error('請輸入有效的 Google 信箱');
  const roles = [...new Set(params.roles)].filter((role) => VALID_ROLES.has(role));
  if (roles.length === 0) throw new Error('請至少指派一個角色');

  await setDoc(
    doc(ctx.db, COL.accessGrants, email),
    {
      email,
      name: params.name?.trim() || null,
      roles,
      active: true,
      grantedBy: { uid: ctx.actor.uid, name: ctx.actor.name },
      grantedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  // 對方若已登入過，直接同步其 staff 文件（免再登出入一次）
  const existing = await findStaffByEmail(ctx.db, email);
  if (existing) {
    await updateDoc(doc(ctx.db, COL.staff, existing.uid), {
      roles,
      active: true,
      ...(params.name?.trim() ? { name: params.name.trim() } : {}),
      updatedAt: serverTimestamp(),
    });
  }

  await addAudit(ctx, {
    action: 'ACCESS_GRANTED',
    entityType: COL.accessGrants,
    entityId: email,
    after: { roles },
  });
  return { email, roles };
}

/** 取消授權（僅管理者）；下一次請求即失效 */
export async function revokeAccess(ctx: Ctx, email: string): Promise<void> {
  const target = normalizeEmail(email);
  if (target === normalizeEmail(ctx.actor.email ?? '')) {
    throw new Error('不可取消自己的授權');
  }

  await setDoc(
    doc(ctx.db, COL.accessGrants, target),
    { active: false, revokedBy: { uid: ctx.actor.uid, name: ctx.actor.name }, updatedAt: serverTimestamp() },
    { merge: true },
  );

  const existing = await findStaffByEmail(ctx.db, target);
  if (existing) {
    await updateDoc(doc(ctx.db, COL.staff, existing.uid), {
      roles: [],
      active: false,
      updatedAt: serverTimestamp(),
    });
  }

  await addAudit(ctx, {
    action: 'ACCESS_REVOKED',
    entityType: COL.accessGrants,
    entityId: target,
  });
}

/** 帳號清單（僅管理者；含尚未登入過的預先授權） */
export async function listAccess(db: Firestore): Promise<AccessUserRow[]> {
  const [grantSnap, staffSnap] = await Promise.all([
    getDocs(collection(db, COL.accessGrants)),
    getDocs(collection(db, COL.staff)),
  ]);

  const byEmail = new Map<string, AccessUserRow>();
  for (const docSnap of grantSnap.docs) {
    byEmail.set(docSnap.id, {
      email: docSnap.id,
      name: (docSnap.get('name') as string | null) ?? null,
      roles: (docSnap.get('roles') as Role[]) ?? [],
      active: docSnap.get('active') !== false,
      signedInBefore: Boolean(docSnap.get('claimedByUid')),
    });
  }
  for (const docSnap of staffSnap.docs) {
    const email = normalizeEmail(String(docSnap.get('email') ?? ''));
    if (!email) continue;
    byEmail.set(email, {
      ...(byEmail.get(email) ?? { email, roles: [], active: true, signedInBefore: true }),
      email,
      uid: docSnap.id,
      name: (docSnap.get('name') as string | null) ?? byEmail.get(email)?.name ?? null,
      roles: (docSnap.get('roles') as Role[]) ?? [],
      active: docSnap.get('active') !== false,
      signedInBefore: true,
    });
  }
  return [...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email));
}

async function findStaffByEmail(db: Firestore, email: string) {
  const snap = await getDocs(collection(db, COL.staff));
  const hit = snap.docs.find((d) => normalizeEmail(String(d.get('email') ?? '')) === email);
  return hit ? { uid: hit.id } : null;
}

async function addAudit(
  ctx: Ctx,
  entry: { action: string; entityType: string; entityId: string; after?: unknown },
) {
  const { addDoc } = await import('firebase/firestore');
  await addDoc(collection(ctx.db, COL.auditLogs), auditDoc(ctx, entry));
}

/** 供測試：確保未使用的匯入不被 tree-shaking 誤判 */
export const __internal = { deleteField };
