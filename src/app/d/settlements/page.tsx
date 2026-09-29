'use client';
import { errorMessage } from '@/client/error-message';
import { useEffect, useState } from 'react';
import type { driverSettlements } from '@/server/services/statements-driver';
import { ErrorMessage, money, useResource } from '../../m/statements/ui';
import { Plate } from '@/components/ui/plate';

const reviews: Record<string, string> = {
  DRAFT: '아직 안 보냄',
  SUBMITTED: '확인 기다림',
  APPROVED: '승인됨',
  NEEDS_FIX: '고쳐서 다시 보내기',
};

/** YYYY-MM 문자열의 첫날·말일 */
function period(month: string) {
  const [year, m] = month.split('-').map(Number);
  const end = new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);
  return { start: `${month}-01`, end };
}
function shift(month: string, delta: number) {
  const [year, m] = month.split('-').map(Number);
  const next = new Date(Date.UTC(year, m - 1 + delta, 1));
  return next.toISOString().slice(0, 7);
}
function thisMonth() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' })
    .format(new Date())
    .slice(0, 7);
}
function monthLabel(month: string) {
  return `${Number(month.slice(0, 4))}년 ${Number(month.slice(5, 7))}월`;
}
function Arrow({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg
      aria-hidden="true"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={dir === 'left' ? 'm15 5-7 7 7 7' : 'm9 5 7 7-7 7'} />
    </svg>
  );
}

/** 기사의 "내 정산": 이번 달 받은 돈·받을 돈을 먼저 보여 준다. */
export default function DriverSettlementsPage() {
  const [month, setMonth] = useState(thisMonth);
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('month');
    if (requested && /^\d{4}-\d{2}$/.test(requested)) setMonth(requested);
  }, []);
  const { start, end } = period(month);
  const result = useResource<Awaited<ReturnType<typeof driverSettlements>>>(
    `/api/statements/mine?${new URLSearchParams({ periodStart: start, periodEnd: end })}`,
  );
  const go = (delta: number) => {
    const next = shift(month, delta);
    setMonth(next);
    window.history.replaceState(null, '', `/d/settlements?month=${next}`);
  };
  const statements = result.data?.statements ?? [];
  const paid = statements.filter((s) => s.paid).reduce((sum, s) => sum + s.grand_total, 0);
  const unpaid = statements.filter((s) => !s.paid).reduce((sum, s) => sum + s.grand_total, 0);
  const summary = result.data?.summary;
  return (
    <div className="space-y-6">
      <h1 className="text-[1.75rem] font-bold">내 정산</h1>

      <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-1.5">
        <button
          type="button"
          aria-label="이전 달"
          className="flex h-14 w-14 items-center justify-center rounded-md hover:bg-slate-100"
          onClick={() => go(-1)}
        >
          <Arrow dir="left" />
        </button>
        <p className="text-xl font-bold" aria-live="polite">
          {monthLabel(month)}
        </p>
        <button
          type="button"
          aria-label="다음 달"
          className="flex h-14 w-14 items-center justify-center rounded-md hover:bg-slate-100 disabled:opacity-30"
          disabled={month >= thisMonth()}
          onClick={() => go(1)}
        >
          <Arrow dir="right" />
        </button>
      </div>

      <ErrorMessage error={result.error ? errorMessage(result.error) : result.error} />
      {result.loading && (
        <p role="status" className="text-lg">
          불러오는 중…
        </p>
      )}

      {result.data && summary && (
        <>
          <section
            aria-label="이번 달 금액"
            className="overflow-hidden rounded-lg border border-slate-200 bg-white"
          >
            <div className="grid grid-cols-2 divide-x divide-slate-200">
              <div className="p-4">
                <p className="font-semibold text-slate-700">받은 돈</p>
                <p className="num mt-1 text-2xl font-bold text-emerald-700">{money(paid)}</p>
              </div>
              <div className="p-4">
                <p className="font-semibold text-slate-700">받을 돈</p>
                <p className="num mt-1 text-2xl font-bold">{money(unpaid)}</p>
              </div>
            </div>
            <p className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-slate-700">
              승인됨 {summary.approved}건 · 확인 기다림 {summary.submitted}건
              {summary.needs_fix > 0 && (
                <>
                  {' · '}
                  <a href="/d" className="font-bold text-orange-700 underline underline-offset-4">
                    고쳐야 할 운행 {summary.needs_fix}건
                  </a>
                </>
              )}
            </p>
          </section>

          <section className="space-y-3" aria-labelledby="statements-title">
            <h2 id="statements-title" className="text-xl font-bold">
              지급명세
            </h2>
            {!statements.length && (
              <p className="rounded-lg bg-white p-5 text-slate-700">
                {monthLabel(month)}에 확정된 지급명세가 아직 없습니다.
              </p>
            )}
            {statements.map((s) => (
              <article key={s.id} className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="num font-bold break-all">{s.statement_no}</h3>
                    <p className="num text-slate-700">
                      {s.period_start} ~ {s.period_end}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-3 py-1 font-bold ${s.paid ? 'bg-emerald-50 text-emerald-800' : 'bg-orange-50 text-orange-800'}`}
                  >
                    {s.paid ? '지급 완료' : '미지급'}
                  </span>
                </div>
                <p className="num mt-3 text-[1.75rem] font-bold">{money(s.grand_total)}</p>
                <p className="text-slate-700">
                  {s.paid ? '입금되었습니다.' : '지급 예정입니다.'} 공급가 {money(s.supply_total)} + 세액{' '}
                  {money(s.tax_total)}
                </p>
                <details className="mt-3 border-t border-slate-200 pt-2">
                  <summary className="flex min-h-12 cursor-pointer items-center font-semibold text-blue-800">
                    운행 {s.items.length}건 자세히 보기
                  </summary>
                  <ul className="divide-y divide-slate-100">
                    {s.items.map((item, index) => (
                      <li key={index} className="py-3">
                        <p className="font-semibold">
                          {item.use_date} · {item.project_name}
                          {item.carried_forward && <span className="ml-1 text-slate-700">(전월분)</span>}
                        </p>
                        <p className="mt-1 flex flex-wrap items-center gap-2">
                          <Plate value={item.plate_no} size="sm" />
                          <span className="text-slate-700">{item.cargo_desc}</span>
                        </p>
                        <p className="num mt-1">
                          {money(item.supply_amount)}{' '}
                          <span className="text-slate-700">+ 세액 {money(item.tax_amount)}</span>
                        </p>
                      </li>
                    ))}
                  </ul>
                </details>
              </article>
            ))}
          </section>

          <section className="space-y-3" aria-labelledby="uses-title">
            <h2 id="uses-title" className="text-xl font-bold">
              {Number(month.slice(5, 7))}월 운행
            </h2>
            {!result.data.uses.length && (
              <p className="rounded-lg bg-white p-5 text-slate-700">이 달 운행이 없습니다.</p>
            )}
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
              {result.data.uses.map((use) => (
                <li key={use.id}>
                  <article className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {use.use_date} · {use.project_name}
                      </p>
                      <p className="text-slate-700">
                        {use.use_no} · {reviews[use.review_status]}
                        {use.held_count > 0 && ` · 보류 ${use.held_count}건`}
                      </p>
                    </div>
                    <p className="num shrink-0 text-right font-bold">
                      <span className="sr-only">인정 공급가 </span>
                      {use.review_status === 'APPROVED' ? money(use.approved_supply) : '검수 전'}
                    </p>
                  </article>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
