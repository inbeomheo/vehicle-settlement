'use client';
import { ClosingPeriodLoader, ClosingPeriodButtons } from '@/components/closing-period';
import { closingPeriod, type ClosingPeriodSettings } from '@/shared/closing-period';
import { errorMessage } from '@/client/error-message';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { button } from '@/components/use-form/fields';
import { driverSettlementPeriodSchema } from '@/shared/driver-settlement-period';
import { PeriodPicker } from './period-picker';
import { UseViews } from './use-views';
import type { driverSettlements } from '@/server/services/statements-driver';
import { ErrorMessage, money, useResource } from '../../m/statements/ui';
import { Plate } from '@/components/ui/plate';

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
/** 2026-09-01 ~ 2026-09-30 → "9월 1일 ~ 30일" (달·해가 다르면 앞에 붙인다) */
function periodLabel(start: string, end: string) {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const from = `${sy !== ey ? `${sy}년 ` : ''}${sm}월 ${sd}일`;
  const to = sy !== ey ? `${ey}년 ${em}월 ${ed}일` : sm !== em ? `${em}월 ${ed}일` : `${ed}일`;
  return `${from} ~ ${to}`;
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

/** 기사의 "내 정산": 이번 마감 받은 돈·받을 돈을 먼저 보여 준다. */
export default function DriverSettlementsPage() {
  return (
    <Suspense fallback={<p role="status">불러오는 중…</p>}>
      <ClosingPeriodLoader>{(settings) => <DriverSettlements settings={settings} />}</ClosingPeriodLoader>
    </Suspense>
  );
}
function DriverSettlements({ settings }: { settings: ClosingPeriodSettings }) {
  const search = useSearchParams();
  const router = useRouter();
  const requested = search.get('month');
  const month =
    requested && /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) && Number(requested.slice(0, 4)) >= 1000
      ? requested
      : thisMonth();
  const explicitPeriod = search.has('from') || search.has('to');
  const custom = explicitPeriod || !requested;
  const current = closingPeriod(settings.today, settings.closing_start_day);
  const monthly = period(month);
  const start = explicitPeriod ? (search.get('from') ?? '') : requested ? monthly.start : current.from;
  const end = explicitPeriod ? (search.get('to') ?? '') : requested ? monthly.end : current.to;
  const valid = driverSettlementPeriodSchema.safeParse({ periodStart: start, periodEnd: end }).success;
  const label = custom ? (valid ? periodLabel(start, end) : '기간을 확인해 주세요') : monthLabel(month);
  const view = search.get('view') === 'date' ? 'date' : 'project';
  const result = useResource<Awaited<ReturnType<typeof driverSettlements>>>(
    `/api/statements/mine?${new URLSearchParams({ periodStart: start, periodEnd: end })}`,
  );
  const navigate = (changes: Record<string, string | null>) => {
    const query = new URLSearchParams(search.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) query.delete(key);
      else query.set(key, value);
    }
    router.push(`/d/settlements?${query}`, { scroll: false });
  };
  const go = (delta: number) => navigate({ month: shift(month, delta), from: null, to: null });
  const statements = result.data?.statements ?? [];
  const paid = statements.filter((s) => s.paid).reduce((sum, s) => sum + s.grand_total, 0);
  const unpaid = statements.filter((s) => !s.paid).reduce((sum, s) => sum + s.grand_total, 0);
  const summary = result.data?.summary;
  return (
    <div className="min-w-0 space-y-6 break-keep [overflow-wrap:anywhere]">
      <h1 className="text-[1.75rem] font-bold">내 정산</h1>

      <ClosingPeriodButtons
        settings={settings}
        driver
        onChange={(period) => navigate({ ...period, month: null })}
      />
      {custom ? (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xl font-bold" aria-live="polite">
            {label}
          </p>
          <button type="button" className={button} onClick={() => navigate({ month, from: null, to: null })}>
            월별로 돌아가기
          </button>
        </div>
      ) : (
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
      )}
      <PeriodPicker
        key={`${start}:${end}`}
        start={valid ? start : monthly.start}
        end={valid ? end : monthly.end}
        onApply={(from, to) => navigate({ from, to })}
      />

      <ErrorMessage
        error={result.error ? errorMessage(result.error) : result.error}
        onRetry={result.reload}
      />
      {result.loading && (
        <p role="status" className="text-lg">
          불러오는 중…
        </p>
      )}

      {result.data && summary && (
        <>
          <section
            aria-label={custom ? '선택 기간 지급 금액' : '이번 달 금액'}
            className="overflow-hidden rounded-lg border border-slate-200 bg-white"
          >
            {custom && (
              <p className="border-b border-slate-200 px-4 py-3 text-sm text-slate-700">
                받은 돈·받을 돈은 선택 기간과 겹치는 지급명세 기준입니다.
              </p>
            )}
            {/* 금액이 커져도 줄이 바뀌지 않도록 한 줄에 하나씩 둔다. */}
            <dl className="divide-y divide-slate-200">
              <div className="flex flex-wrap items-baseline justify-between gap-3 p-4">
                <dt className="shrink-0 font-semibold text-slate-700">받은 돈</dt>
                <dd className="num text-2xl font-bold whitespace-nowrap text-emerald-700">{money(paid)}</dd>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-3 p-4">
                <dt className="shrink-0 font-semibold text-slate-700">받을 돈</dt>
                <dd className="num text-2xl font-bold whitespace-nowrap">{money(unpaid)}</dd>
              </div>
            </dl>
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
                {label}에 확정된 지급명세가 아직 없습니다.
              </p>
            )}
            {statements.map((s) => (
              <article key={s.id} className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="num font-bold break-all">{s.statement_no}</h3>
                    <p className="num text-slate-700">{periodLabel(s.period_start, s.period_end)}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-3 py-1 font-bold ${s.paid ? 'bg-emerald-50 text-emerald-800' : 'bg-orange-50 text-orange-800'}`}
                  >
                    {s.paid ? '지급 완료' : '미지급'}
                  </span>
                </div>
                <p className="num mt-3 text-[1.5rem] font-bold whitespace-nowrap">{money(s.grand_total)}</p>
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
              {custom ? '선택 기간 운행' : `${Number(month.slice(5, 7))}월 운행`}
            </h2>
            {!result.data.uses.length && (
              <p className="rounded-lg bg-white p-5 text-slate-700">
                {custom ? '이 기간 운행이 없습니다.' : '이 달 운행이 없습니다.'}
              </p>
            )}
            <UseViews data={result.data} view={view} onView={(next) => navigate({ view: next })} />
          </section>
        </>
      )}
    </div>
  );
}
