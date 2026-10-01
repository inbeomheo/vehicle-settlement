import type { LedgerRow } from '@/server/services/ledger';
import { api, mutate } from './common';
/** 증빙·단가·추가비 요청에 걸리는 것이 없으면 목록에서 바로 승인할 수 있다. */
export function quickApprovable(row: LedgerRow) {
  return (
    row.review_status === 'SUBMITTED' &&
    row.operation_status !== 'CANCELED' &&
    !row.evidence_missing &&
    !row.has_requested_extra &&
    !row.has_base_amount_difference &&
    row.review_total_amount !== null
  );
}

export async function approveUse(id: string) {
  const detail = await api<{ version: number }>(`/api/uses/${id}`);
  await mutate(`/api/uses/${id}/approve`, 'POST', { version: detail.version });
}
