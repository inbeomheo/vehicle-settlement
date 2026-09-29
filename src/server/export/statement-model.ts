import { formatQuantity } from '../../shared/quantity';
import type { Context } from '../context';
import { getStatement, type ItemSnapshot } from '../services/statements';
export const billingLabels: Record<string, string> = {
  PER_TRIP: '회당',
  PER_DAY: '일대',
  HALF_DAY: '반일',
  MONTHLY: '월대',
  PER_HOUR: '시간',
  PER_TON: '톤',
  PER_M3: '루베',
  LUMP_SUM: '1식',
};
const chargeLabels: Record<string, string> = {
  BASE: '기본운임',
  WAITING: '대기료',
  TOLL: '통행료',
  EXTRA_STOP: '경유비',
  CANCEL_FEE: '취소·회차비',
  EXPENSE: '실비',
  OTHER: '기타',
  ADJUSTMENT: '조정',
};
export function exportChargeUnit(type: string | undefined, unit: string) {
  if (type && type !== 'BASE' && !['PER_HOUR', 'PER_TON', 'PER_M3'].includes(unit)) return '건';
  return billingLabels[unit] ?? '—';
}
export const exportHeaders = [
  '실제 사용일',
  '사용번호',
  '현장',
  '차량',
  '기사',
  '운반내용',
  '비용 종류',
  '운행수',
  '과금단위',
  '수량',
  '단가',
  '공급가',
  '세액',
  '비고',
];
export const formatWon = (n: number) => `${n.toLocaleString('ko-KR')}원`;
export function seoulTime(value: Date | string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value));
}
export async function statementExportModel(ctx: Context, id: string) {
  // getStatement uses only frozen statement/item fields once confirmed or canceled.
  const statement = await getStatement(ctx, id);
  return {
    id: statement.id,
    document_no: statement.statement_no ?? `DRAFT-${statement.id.slice(0, 8)}`,
    title: statement.direction === 'PAYABLE' ? '운송사 지급명세' : '원청 청구명세',
    draft: statement.status === 'DRAFT',
    canceled: statement.status === 'CANCELED',
    counterparty: statement.counterparty_snapshot ?? {},
    issuer: statement.issuer_snapshot ?? {},
    period: `${statement.period_start} ~ ${statement.period_end}`,
    issued_on: String(
      statement.issuer_snapshot?.issued_on ?? statement.created_at.toISOString().slice(0, 10),
    ),
    confirmed_at: seoulTime(statement.confirmed_at),
    due_date: statement.due_date ?? '미정',
    contact: String(statement.issuer_snapshot?.prepared_by ?? ''),
    rows: statement.items
      .filter((i) => i.inclusion === 'INCLUDED')
      .map((i) => ({
        ...(i.snapshot as ItemSnapshot),
        supply_amount: i.supply_amount,
        tax_amount: i.tax_amount,
      })),
    supply_total: statement.supply_total,
    tax_total: statement.tax_total,
    grand_total: statement.grand_total,
    disclaimer: '본 문서는 세금계산서가 아닙니다',
  };
}
export type StatementExportModel = Awaited<ReturnType<typeof statementExportModel>>;
export function rowValues(row: StatementExportModel['rows'][number]): (string | number | null)[] {
  return [
    row.use_date,
    row.use_no,
    row.project_name,
    row.plate_no,
    row.driver_name,
    row.cargo_desc,
    chargeLabels[row.charge_type ?? ''] ?? '—',
    row.trip_count,
    exportChargeUnit(row.charge_type, row.billing_unit),
    row.quantity === null ? null : formatQuantity(row.quantity),
    row.unit_price,
    row.supply_amount,
    row.tax_amount,
    [row.carried_forward ? '전월분' : '', row.charge_type === 'ADJUSTMENT' ? '조정' : '', row.notes]
      .filter(Boolean)
      .join(' / '),
  ];
}
