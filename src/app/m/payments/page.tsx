'use client';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { paymentOverview } from '@/server/services/payments';
import { DirectionTabs, ErrorMessage, money, Pagination, panelClass, useResource } from '../statements/ui';
import { PaymentPanel } from './payment-panel';
function PaymentsContent({ requestedState }: { requestedState: string | null }) {
  const [direction, setDirection] = useState<'PAYABLE' | 'RECEIVABLE'>('PAYABLE');
  const [state, setState] = useState(() =>
    requestedState && ['ALL', 'UNPAID', 'OVERDUE', 'PAID'].includes(requestedState)
      ? requestedState
      : 'UNPAID',
  );
  const [page, setPage] = useState(1);
  const result = useResource<Awaited<ReturnType<typeof paymentOverview>>>(
    `/api/payments/overview?${new URLSearchParams({ direction, state, page: String(page) })}`,
  );
  const word = direction === 'PAYABLE' ? '지급' : '입금';
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">지급·입금 관리</h1>
      <DirectionTabs
        value={direction}
        onChange={(d) => {
          setDirection(d);
          setPage(1);
        }}
      />
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">
          조회 상태{' '}
          <select
            className="ml-2 min-h-11 rounded-lg border border-slate-300 bg-white px-3"
            value={state}
            onChange={(e) => {
              setState(e.target.value);
              setPage(1);
            }}
          >
            <option value="ALL">전체</option>
            <option value="UNPAID">미{word}</option>
            <option value="OVERDUE">예정일 경과</option>
            <option value="PAID">{word} 완료</option>
          </select>
        </label>
      </div>
      <ErrorMessage error={result.error} />
      {result.loading && <p role="status">{word} 내역을 불러오는 중…</p>}
      {result.data && (
        <>
          <section className={`${panelClass} space-y-3`}>
            <h2 className="text-lg font-bold">거래처·현장별 미{word}</h2>
            <p className="text-sm text-slate-600">
              현재 페이지 {money(result.data.totals.pageSum)} · 전체 검색 합계{' '}
              {money(result.data.totals.filteredSum)}
            </p>
            {!result.data.groups.length && (
              <p className="text-sm text-slate-500">해당 조건의 미{word} 내역이 없습니다.</p>
            )}
            {result.data.groups.map((g) => (
              <div
                key={`${g.counterparty_id}-${g.project_id}`}
                className="flex flex-wrap justify-between gap-2 border-t pt-3 text-sm"
              >
                <span>
                  {g.counterparty_name} · {g.project_name}
                </span>
                <span>
                  {g.unpaid_count}건 · <strong>{money(g.unpaid_amount)}</strong>{' '}
                  <span className="text-red-700">
                    예정일 경과 {g.overdue_count}건 · {money(g.overdue_amount)}
                  </span>
                </span>
              </div>
            ))}
          </section>
          {!result.data.rows.length && (
            <p className="py-5 text-center text-slate-500">해당 조건의 확정 명세가 없습니다.</p>
          )}
          {result.data.rows.map((statement) => (
            <section key={statement.id} className={`${panelClass} space-y-5`}>
              <div className="flex flex-wrap justify-between gap-3">
                <div>
                  <Link className="font-bold text-blue-700 underline" href={`/m/statements/${statement.id}`}>
                    {statement.statement_no}
                  </Link>
                  <p className="mt-1 text-sm">
                    {String(statement.counterparty_snapshot?.name)} · {statement.period_start} ~{' '}
                    {statement.period_end}
                  </p>
                </div>
                <p className={`text-sm ${statement.overdue ? 'font-bold text-red-700' : 'text-slate-600'}`}>
                  {word} 예정일 {statement.due_date ?? '미정'} {statement.overdue && '· 예정일 경과'}
                </p>
              </div>
              <PaymentPanel statement={statement} onChange={result.reload} />
            </section>
          ))}
          <Pagination
            page={page}
            pageSize={result.data.pageSize}
            total={result.data.total}
            onPage={setPage}
          />
        </>
      )}
    </div>
  );
}

function PaymentQuery() {
  const search = useSearchParams();
  return (
    <PaymentsContent key={search.toString()} requestedState={search.get('state') ?? search.get('status')} />
  );
}
export default function PaymentsPage() {
  return (
    <Suspense fallback={<p role="status">지급 내역을 불러오는 중…</p>}>
      <PaymentQuery />
    </Suspense>
  );
}
