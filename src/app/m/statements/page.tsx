'use client';
import Link from 'next/link';
import { signalClass } from '@/components/manager/common';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { NewStatement } from './new-statement';
import {
  DirectionTabs,
  ErrorMessage,
  money,
  Pagination,
  panelClass,
  secondaryClass,
  statusLabels,
  StatementBadge,
  useResource,
  type StatementList,
} from './ui';
export default function StatementsPage() {
  const router = useRouter();
  const [direction, setDirection] = useState<'PAYABLE' | 'RECEIVABLE'>('PAYABLE');
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const result = useResource<StatementList>(
    `/api/statements?${new URLSearchParams({ direction, page: String(page), ...(status ? { status } : {}) })}`,
  );
  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[1.75rem] font-bold">월 정산</h1>
          <p className="mt-2 text-sm text-slate-600">승인된 비용을 모아 거래처별 명세를 확정합니다.</p>
        </div>
        <button className={creating ? secondaryClass : signalClass} onClick={() => setCreating(!creating)}>
          {creating ? '새 정산 닫기' : '새 정산'}
        </button>
      </div>
      <DirectionTabs
        value={direction}
        onChange={(value) => {
          setDirection(value);
          setPage(1);
        }}
      />
      {creating && (
        <NewStatement
          key={direction}
          direction={direction}
          onCreated={(id) => router.push(`/m/statements/${id}`)}
        />
      )}
      <section className={`${panelClass} space-y-4`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">
            {direction === 'PAYABLE' ? '운송사 지급명세' : '원청 청구명세'}
          </h2>
          <label className="text-sm">
            상태{' '}
            <select
              className="ml-2 min-h-11 text-base rounded border border-slate-300 px-3"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">전체</option>
              {Object.entries(statusLabels).map(([key, value]) => (
                <option key={key} value={key}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ErrorMessage error={result.error} onRetry={result.reload} />
        {result.loading && <p role="status">명세를 불러오는 중…</p>}
        {result.data && (
          <>
            <div className="flex flex-wrap gap-4 text-sm text-slate-600">
              <p>
                현재 페이지 합계 <strong>{money(result.data.totals.pageSum)}</strong>
              </p>
              <p>
                전체 검색 합계 <strong>{money(result.data.totals.filteredSum)}</strong>
              </p>
            </div>
            <p className="text-sm text-slate-600">확정 명세만 합산 · 작성 중·취소 제외</p>
            {!result.data.rows.length ? (
              <p className="py-8 text-center text-slate-600">
                작성된 명세가 없습니다. 새 정산에서 시작하세요.
              </p>
            ) : (
              <div className="md:overflow-x-auto">
                <table className="block w-full text-left text-sm md:table md:min-w-[750px]">
                  <thead className="hidden bg-slate-50 md:table-header-group">
                    <tr>
                      {['명세', '정산 기간', '거래처', '합계', '상태', '지급·입금'].map((h) => (
                        <th key={h} className="p-3">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="grid gap-4 md:table-row-group">
                    {result.data.rows.map((row) => (
                      <tr
                        key={row.id}
                        className="grid grid-cols-2 rounded-lg border p-2 md:table-row md:rounded-none md:border-0 md:border-b md:p-0"
                      >
                        <td className="p-3">
                          <Link
                            className="inline-flex min-h-11 items-center break-all font-semibold text-blue-700 underline"
                            href={`/m/statements/${row.id}`}
                          >
                            {row.statement_no ?? '작성 중 명세'}
                          </Link>
                        </td>
                        <td className="p-3">
                          {row.period_start}
                          <br />
                          {row.period_end}
                        </td>
                        <td className="p-3">{String(row.counterparty_snapshot?.name ?? '')}</td>
                        <td className="p-3 tabular-nums">
                          <span className="block text-xs text-slate-600 md:hidden">합계</span>
                          {money(row.grand_total)}
                        </td>
                        <td className="p-3">
                          <StatementBadge status={row.status} />
                        </td>
                        <td className="p-3">
                          {row.status === 'CANCELED'
                            ? '—(취소됨)'
                            : row.status === 'DRAFT'
                              ? '—(작성 중)'
                              : row.payment_status === 'PAID'
                                ? direction === 'PAYABLE'
                                  ? '지급 완료'
                                  : '입금 완료'
                                : direction === 'PAYABLE'
                                  ? '미지급'
                                  : '미입금'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pagination
              page={page}
              pageSize={result.data.pageSize}
              total={result.data.total}
              onPage={setPage}
            />
          </>
        )}
      </section>
    </div>
  );
}
