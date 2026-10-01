'use client';
import type { SummaryResult } from '@/server/services/summary';
import { formatQuantity } from '@/shared/quantity';
import { Field, inputClass, money, panelClass, secondaryClass } from './common';

export function SummaryDetail({
  data,
  driverId,
  sort,
  onDriver,
  onSort,
  onClose,
  onExport,
  exporting,
}: {
  data: SummaryResult;
  driverId: string;
  sort: string;
  onDriver: (id: string) => void;
  onSort: (sort: string) => void;
  onClose: () => void;
  onExport: () => void;
  exporting: boolean;
}) {
  return (
    <section aria-label="운행 상세" className={`${panelClass} mb-5 min-w-0`}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-ink">운행 상세</h2>
          <p className="mt-1 break-words text-sm text-slate-600">
            {data.from} ~ {data.to} · {data.projects.map((p) => p.name).join(', ')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={secondaryClass} disabled={exporting} onClick={onExport}>
            거래명세표 엑셀
          </button>
          <button className={secondaryClass} onClick={onClose}>
            상세 닫기
          </button>
        </div>
      </header>
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Field title="기사 이름">
          <select
            className={inputClass}
            aria-label="기사 이름"
            value={driverId}
            onChange={(e) => onDriver(e.target.value)}
          >
            <option value="">전체 기사</option>
            {data.options.drivers.map((driver) => (
              <option key={driver.id} value={driver.id}>
                {driver.name}
              </option>
            ))}
          </select>
        </Field>
        <Field title="정렬">
          <select
            className={inputClass}
            aria-label="정렬"
            value={sort}
            onChange={(e) => onSort(e.target.value)}
          >
            <option value="date">날짜순</option>
            <option value="driver">기사 이름순</option>
          </select>
        </Field>
      </div>
      <p className="mb-3 text-sm text-slate-600">
        추가 비용은 별도 줄입니다. 수량은 청구 수량이며, 단가는 계약의 세금 기준을 따릅니다. 검수 전 금액은
        승인 합계에서 제외합니다.
      </p>
      <div className="max-w-full overflow-x-auto" role="region" aria-label="운행 상세 표" tabIndex={0}>
        <table className="w-full min-w-[960px] border-collapse text-sm">
          <thead className="bg-slate-50">
            <tr>
              {['날짜', '현장', '구간', '규격', '수량', '단가', '공급가액', '비고', '기사명', '상태'].map(
                (title) => (
                  <th
                    key={title}
                    scope="col"
                    className="border-b border-slate-200 px-3 py-3 text-left whitespace-nowrap"
                  >
                    {title}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.id} className={row.status === 'PENDING' ? 'text-slate-600' : ''}>
                <td className="border-b border-slate-200 px-3 py-3 whitespace-nowrap">
                  {row.use_date.slice(5).replace('-', '/')}
                </td>
                <td className="max-w-48 border-b border-slate-200 px-3 py-3 break-words">
                  {row.project_name}
                </td>
                <td className="max-w-64 border-b border-slate-200 px-3 py-3 break-words">{row.route}</td>
                <td className="border-b border-slate-200 px-3 py-3 whitespace-nowrap">
                  {row.load_tonnage ? `${formatQuantity(row.load_tonnage)}t` : '—'}
                </td>
                <td className="border-b border-slate-200 px-3 py-3 text-right tabular-nums">
                  {row.quantity === null ? '—' : formatQuantity(row.quantity)}
                </td>
                <td className="border-b border-slate-200 px-3 py-3 text-right whitespace-nowrap tabular-nums">
                  {row.unit_price === null ? '—' : money(row.unit_price)}
                </td>
                <td className="border-b border-slate-200 px-3 py-3 text-right whitespace-nowrap tabular-nums">
                  {row.supply === null ? '금액 미정' : money(row.supply)}
                </td>
                <td className="max-w-64 border-b border-slate-200 px-3 py-3 break-words">
                  {row.cargo_desc || '—'}
                </td>
                <td className="border-b border-slate-200 px-3 py-3">{row.driver_name}</td>
                <td className="border-b border-slate-200 px-3 py-3 whitespace-nowrap">
                  {row.status === 'APPROVED' ? '승인' : '검수 전'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data.rows.length && <p className="py-4 text-slate-600">선택한 조건의 운행이 없습니다.</p>}
      <dl className="mt-4 grid gap-3 rounded-lg bg-slate-50 p-4 sm:grid-cols-3" aria-label="상세 합계">
        {[
          ['공급가 합계', data.totals.approved_supply],
          ['부가세', data.totals.approved_tax],
          ['합계', data.totals.grand_total],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm text-slate-600">{label}</dt>
            <dd className="mt-1 text-lg font-bold tabular-nums">{money(Number(value))}</dd>
          </div>
        ))}
      </dl>
      {data.include === 'all' && (
        <p className="mt-3 text-sm text-slate-600">
          검수 전 공급가 {money(data.totals.pending_supply)} (합계 제외) · 금액 미정{' '}
          {data.totals.pending_unknown_count}줄
        </p>
      )}
    </section>
  );
}
