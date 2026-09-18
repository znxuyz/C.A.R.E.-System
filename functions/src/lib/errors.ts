/** 統一錯誤型別；handlers 層轉為 HttpsError 回傳前端 */
export type AppErrorCode =
  | 'NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'INVALID_ARGUMENT'
  | 'FAILED_PRECONDITION'
  | 'ALREADY_EXISTS'
  | 'INTERNAL';

export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what: string) => new AppError('NOT_FOUND', `${what}不存在`);
export const denied = (why: string) => new AppError('PERMISSION_DENIED', why);
export const invalid = (why: string) => new AppError('INVALID_ARGUMENT', why);
export const precondition = (why: string) => new AppError('FAILED_PRECONDITION', why);
