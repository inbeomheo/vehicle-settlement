type QuickApprovalRow = {
  review_status: string;
  operation_status: string;
  evidence_missing: boolean;
  receivable_needs_review: boolean;
  has_held_lines: boolean;
  has_requested_extra: boolean;
  has_base_amount_difference: boolean;
  review_total_amount: number | null;
};

export function quickApprovalIssues(row: QuickApprovalRow): string[] {
  return [
    row.evidence_missing && '증빙 없음',
    row.has_requested_extra && '요청 추가비 확인 필요',
    row.has_base_amount_difference && '계약 단가와 다른 금액',
    row.receivable_needs_review && '고객 청구 금액 확인 필요',
    row.has_held_lines && '보류 항목 있음',
    row.review_total_amount === null && '단가 미확정',
  ].filter((issue): issue is string => typeof issue === 'string');
}

/** 목록과 승인 트랜잭션에서 같은 바로 승인 조건을 적용한다. */
export function quickApprovable(row: QuickApprovalRow) {
  return (
    row.review_status === 'SUBMITTED' &&
    row.operation_status !== 'CANCELED' &&
    quickApprovalIssues(row).length === 0
  );
}
