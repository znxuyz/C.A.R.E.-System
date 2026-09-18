/**
 * 呼叫端身分與權限（單人系統）
 *
 * 只有兩種身分：生活教育組長（DISCIPLINE_STAFF）與系統管理者（ADMIN）。
 * 角色來源為 Firebase Auth custom claims `roles: string[]`。
 * 公開看板不需登入，但它只讀一份去識別化摘要文件，不經過這裡。
 */
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { ROLES, type Role } from '../domain/types.js';
import { AppError } from '../lib/errors.js';
import { CaseRuleError } from '../domain/caseRules.js';

export interface CallerContext {
  uid: string;
  name: string;
  roles: Role[];
}

export function requireStaff(request: CallableRequest): CallerContext {
  const auth = request.auth;
  if (!auth) throw new HttpsError('unauthenticated', '請先登入');
  const claims = auth.token as Record<string, unknown>;
  const roles = (Array.isArray(claims.roles) ? claims.roles : []) as Role[];
  if (!roles.includes(ROLES.DISCIPLINE_STAFF) && !roles.includes(ROLES.ADMIN)) {
    throw new HttpsError('permission-denied', '此系統僅供生活教育組使用');
  }
  return {
    uid: auth.uid,
    name: (claims.name as string) ?? (claims.email as string) ?? auth.uid,
    roles,
  };
}

export function requireAdmin(request: CallableRequest): CallerContext {
  const caller = requireStaff(request);
  if (!caller.roles.includes(ROLES.ADMIN)) {
    throw new HttpsError('permission-denied', '此操作僅限系統管理者');
  }
  return caller;
}

/** 將 AppError / CaseRuleError 轉為前端可讀的 HttpsError */
export function toHttpsError(error: unknown): HttpsError {
  if (error instanceof HttpsError) return error;
  if (error instanceof AppError) {
    const map: Record<
      string,
      'not-found' | 'permission-denied' | 'invalid-argument' | 'failed-precondition' | 'already-exists' | 'internal'
    > = {
      NOT_FOUND: 'not-found',
      PERMISSION_DENIED: 'permission-denied',
      INVALID_ARGUMENT: 'invalid-argument',
      FAILED_PRECONDITION: 'failed-precondition',
      ALREADY_EXISTS: 'already-exists',
      INTERNAL: 'internal',
    };
    return new HttpsError(map[error.code] ?? 'internal', error.message, error.details);
  }
  if (error instanceof CaseRuleError) {
    return new HttpsError('failed-precondition', error.message);
  }
  return new HttpsError('internal', error instanceof Error ? error.message : '系統錯誤');
}
