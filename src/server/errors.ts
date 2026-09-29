export const errorStatuses = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  VERSION_CONFLICT: 409,
  STATEMENT_LOCKED: 409,
  CONFIRM_BLOCKED: 422,
  SUBMIT_BLOCKED: 422,
  IDEMPOTENCY_MISMATCH: 422,
} as const;
export type ErrorCode = keyof typeof errorStatuses;
export class AppError extends Error {
  readonly status: number;
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.status = errorStatuses[code];
  }
}
export function notFound(): never {
  throw new AppError('NOT_FOUND', '자료를 찾을 수 없습니다.');
}
export function invalid(message: string, details?: unknown): never {
  throw new AppError('VALIDATION_FAILED', message, details);
}
