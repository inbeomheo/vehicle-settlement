type QuickApprovalRow = {
  review_status: string;
  operation_status: string;
  evidence_missing: boolean;
  has_requested_extra: boolean;
  has_base_amount_difference: boolean;
  review_total_amount: number | null;
};

/** 목록과 승인 트랜잭션에서 같은 바로 승인 조건을 적용한다. */
export function quickApprovable(row: QuickApprovalRow) {
  return (
    row.review_status === 'SUBMITTED' &&
    row.operation_status !== 'CANCELED' &&
    !row.evidence_missing &&
    !row.has_requested_extra &&
    !row.has_base_amount_difference &&
    row.review_total_amount !== null
  );
}
