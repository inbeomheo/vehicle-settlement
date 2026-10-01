import type { LedgerRow } from '@/server/services/ledger';
import { mutate } from './common';
export { quickApprovable, quickApprovalIssues } from '@/shared/quick-approval';

export async function approveUse(row: LedgerRow) {
  await mutate(`/api/uses/${row.id}/approve`, 'POST', {
    version: row.version,
    quick_approval: {
      review_base_amount: row.review_base_amount,
      review_extra_amount: row.review_extra_amount,
      review_total_amount: row.review_total_amount,
      review_receivable_amount: row.review_receivable_amount,
    },
  });
}
