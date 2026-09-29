import { AppError } from '../errors';
export type ReviewStatus = 'DRAFT' | 'SUBMITTED' | 'NEEDS_FIX' | 'APPROVED';
export function assertTransition(status: ReviewStatus, action: 'submit' | 'approve' | 'request-fix') {
  const allowed = { submit: ['DRAFT', 'NEEDS_FIX'], approve: ['SUBMITTED'], 'request-fix': ['SUBMITTED'] };
  if (!allowed[action].includes(status))
    throw new AppError('VALIDATION_FAILED', '현재 검수 상태에서는 이 작업을 할 수 없습니다.');
}
export function reviewAfterEdit(status: ReviewStatus, isDriver: boolean): ReviewStatus {
  return status === 'APPROVED' || status === 'SUBMITTED' ? (isDriver ? 'DRAFT' : 'SUBMITTED') : status;
}
