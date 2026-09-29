import { Plate } from '@/components/ui/plate';
import { formatQuantity } from '@/shared/quantity';
import { chargeTypeLabel, chargeUnitLabel } from '@/components/manager/charge-display';
import type { ItemSnapshot } from '@/server/services/statements';
import { money, type StatementDetail } from './ui';

export function StatementItems({ items }: { items: StatementDetail['items'] }) {
  const headers = [
    '사용일 / 사용번호',
    '현장',
    '차량 / 기사',
    '비용 종류',
    '운반 내용',
    '운행수',
    '과금단위',
    '수량',
    '단가',
    '공급가',
    '세액',
    '비고',
  ];
  // 현장·운반 내용·비고만 줄바꿈하고, 번호·이름·금액은 한 줄로 둔다.
  const wrapping = new Set(['현장', '운반 내용', '비고']);
  const numeric = new Set(['운행수', '수량', '단가', '공급가', '세액']);
  const cellClass = (header: string) =>
    wrapping.has(header)
      ? 'min-w-0 break-keep whitespace-pre-wrap md:min-w-32 md:max-w-64'
      : `min-w-0 break-words md:whitespace-nowrap ${numeric.has(header) ? 'num md:text-right' : ''}`;
  return (
    <div className="md:overflow-x-auto">
      <table className="block w-full text-left text-sm md:table">
        <thead className="hidden bg-slate-50 md:table-header-group">
          <tr>
            {headers.map((header) => (
              <th
                key={header}
                className={`p-3 whitespace-nowrap ${numeric.has(header) ? 'md:text-right' : ''}`}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="grid gap-4 md:table-row-group">
          {items.map((item) => {
            const snapshot = item.snapshot as ItemSnapshot;
            const values = [
              <>
                <span className="block">{snapshot.use_date}</span>
                {snapshot.use_no}
              </>,
              snapshot.project_name,
              <>
                <span className="block">
                  <Plate value={String(snapshot.plate_no ?? '')} size="sm" />
                </span>
                {snapshot.driver_name}
              </>,
              chargeTypeLabel(snapshot.charge_type),
              snapshot.cargo_desc || '—',
              snapshot.trip_count,
              chargeUnitLabel(snapshot.charge_type, snapshot.billing_unit),
              formatQuantity(snapshot.quantity),
              snapshot.unit_price === null && snapshot.charge_type && snapshot.charge_type !== 'BASE'
                ? '—'
                : money(snapshot.unit_price),
              money(item.supply_amount),
              money(item.tax_amount),
              <>
                {snapshot.carried_forward && (
                  <span className="mr-2 rounded bg-amber-100 px-2 text-amber-900">전월분</span>
                )}
                {snapshot.notes || '—'}
              </>,
            ];
            return (
              <tr
                key={item.id}
                className="grid grid-cols-2 rounded-lg border border-slate-200 p-2 align-top md:table-row md:rounded-none md:border-0 md:border-b md:p-0"
              >
                {values.map((value, index) => (
                  <td key={headers[index]} className={`p-3 align-top ${cellClass(headers[index])}`}>
                    <span className="mb-1 block text-xs text-slate-600 md:hidden">{headers[index]}</span>
                    {value}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
