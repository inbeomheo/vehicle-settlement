import type { LedgerRow } from '@/server/services/ledger';
import { money } from './common';

/** 승인 대상 고객 청구와 승인에서 제외되는 보류액을 방향별로 표시한다. */
export function ReviewOtherAmounts({ row }: { row: LedgerRow }) {
  return (
    <div className="num space-y-1 text-sm">
      {(row.review_receivable_amount !== null || row.receivable_needs_review) && (
        <p>
          청구 {row.review_receivable_amount === null ? '금액 미정' : money(row.review_receivable_amount)}
        </p>
      )}
      {row.has_held_payable && (
        <p className="text-orange-700">
          보류 지급 {row.held_payable_amount === null ? '금액 미정' : money(row.held_payable_amount)}
        </p>
      )}
      {row.has_held_receivable && (
        <p className="text-orange-700">
          보류 청구 {row.held_receivable_amount === null ? '금액 미정' : money(row.held_receivable_amount)}
        </p>
      )}
    </div>
  );
}
