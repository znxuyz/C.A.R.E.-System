/**
 * 呼叫端身分與權限
 *
 * 角色來源：Firebase Auth 的 custom claims `roles: string[]`
 * （由 admin 端 setUserRoles 寫入；學生帳號另帶 `studentId`）。
 * 前端只讀 claims 決定顯示哪些頁籤，真正的授權一律在此處與安全規則把關。
 */
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { ROLES, type Role } from '../domain/types.js';
import { AppError } from '../lib/errors.js';

export interface CallerContext {
  uid: string;
  name: string;
  roles: Role[];
  studentId?: string;
}

export function requireAuth(request: CallableRequest): CallerContext {
  const auth = request.auth;
  if (!auth) throw new HttpsError('unauthenticated', '請先登入');
  const claims = auth.token as Record<string, unknown>;
  const roles = (Array.isArray(claims.roles) ? claims.roles : []) as Role[];
  return {
    uid: auth.uid,
    name: (claims.name as string) ?? (claims.email as string) ?? auth.uid,
    roles,
    studentId: claims.studentId as string | undefined,
  };
}

export function requireRole(request: CallableRequest, ...allowed: Role[]): CallerContext {
  const caller = requireAuth(request);
  if (!caller.roles.some((role) => allowed.includes(role) || role === ROLES.ADMIN)) {
    throw new HttpsError(
      'permission-denied',
      `此操作僅限 ${allowed.join(' / ')}（目前角色：${caller.roles.join(',') || '無'}）`,
    );
  }
  return caller;
}

/** 可登錄違規者：生教組、糾察隊、巡堂教師（導師）、管理者 */
export function requireReporter(request: CallableRequest): CallerContext {
  return requireRole(
    request,
    ROLES.DISCIPLINE_STAFF,
    ROLES.PATROL,
    ROLES.HOMEROOM_TEACHER,
    ROLES.ADMIN,
  );
}

/** 將 AppError / WorkflowError 轉為前端可讀的 HttpsError */
export function toHttpsError(error: unknown): HttpsError {
  if (error instanceof HttpsError) return error;
  if (error instanceof AppError) {
    const map: Record<string, 'not-found' | 'permission-denied' | 'invalid-argument' | 'failed-precondition' | 'already-exists' | 'internal'> = {
      NOT_FOUND: 'not-found',
      PERMISSION_DENIED: 'permission-denied',
      INVALID_ARGUMENT: 'invalid-argument',
      FAILED_PRECONDITION: 'failed-precondition',
      ALREADY_EXISTS: 'already-exists',
      INTERNAL: 'internal',
    };
    return new HttpsError(map[error.code] ?? 'internal', error.message, error.details);
  }
  if (error instanceof Error && error.name === 'WorkflowError') {
    return new HttpsError('failed-precondition', error.message);
  }
  return new HttpsError('internal', error instanceof Error ? error.message : '系統錯誤');
}
