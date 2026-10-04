'use client';
import { ClosingPeriodLoader, ClosingPeriodButtons } from '@/components/closing-period';
import { closingPeriod, type ClosingPeriodSettings } from '@/shared/closing-period';
import { formatQuantity } from '@/shared/quantity';
import Link from 'next/link';
import { SummaryDetail } from './summary-detail';
import { useEffect, useState } from 'react';
import type { SummaryAmounts, SummaryCell, SummaryResult } from '@/server/services/summary';
import {
  Empty,
  Field,
  Heading,
  Notice,
  buttonClass,
  inputClass,
  money,
  panelClass,
  secondaryClass,
  useRemote,
} from './common';

type Query = {
  from: string;
  to: string;
  include: string;
  view: string;
  project_id: string;
  driver_id: string;
  payee_counterparty_id: string;
  detail: string;
  sort: string;
};
const queryString = (query: Query) => new URLSearchParams(query).toString();
function Amount({
  value,
  pending,
  blankZero = false,
}: {
  value: SummaryAmounts;
  pending: boolean;
  blankZero?: boolean;
}) {
  return (
    <div className="min-w-0 text-right tabular-nums">
      <p className="break-words font-bold">
        {blankZero && value.approved_supply === 0 ? '' : money(value.approved_supply)}
      </p>
      {pending && value.pending_supply !== 0 && (
        <p className="mt-1 text-sm text-slate-600">검수 전 {money(value.pending_supply)}</p>
      )}
      {pending && value.pending_unknown_count > 0 && (
        <p className="mt-1 text-sm text-slate-600">금액 미정 {value.pending_unknown_count}줄</p>
      )}
    </div>
  );
}
function ledgerHref(query: Query, cell: SummaryCell) {
  return `/m/ledger?${new URLSearchParams({ from: query.from, to: query.to, project_id: cell.project_id, driver_id: cell.driver_id })}`;
}
function SummaryCards({
  data,
  query,
  onDetail,
}: {
  data: SummaryResult;
  query: Query;
  onDetail: (id: string, byProject: boolean) => void;
}) {
  const byProject = query.view !== 'drivers';
  const groups = byProject ? data.projects : data.drivers;
  const pending = data.include === 'all';
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-2">
      {groups.map((group) => {
        const driver = byProject ? undefined : data.drivers.find((item) => item.id === group.id);
        const cells = data.cells
          .filter((cell) => (byProject ? cell.project_id : cell.driver_id) === group.id)
          .sort((a, b) => b.approved_supply - a.approved_supply);
        return (
          <article key={group.id} className={panelClass}>
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
              <div className="min-w-0 break-words">
                <h2 className="text-lg font-bold text-ink">{group.name}</h2>
                <p className="mt-1 break-words text-sm text-slate-600">
                  담당: {group.reviewers.join(', ')} · 적재용량:{' '}
                  {group.loads.map((value) => `${formatQuantity(value)}톤`).join(', ') || '—'}
                </p>
                {driver && (
                  <p className="mt-1 text-sm text-slate-600">
                    {driver.affiliations.join(', ') || '소속 정보 없음'}
                  </p>
                )}
                <p className="mt-1 text-sm text-slate-600">운행 {group.count.toLocaleString('ko-KR')}건</p>
              </div>
              <div className="min-w-0 text-right">
                <Amount value={group} pending={pending} />
                <button className={`${secondaryClass} mt-2`} onClick={() => onDetail(group.id, byProject)}>
                  자세히 보기
                </button>
              </div>
            </header>
            <ul className="divide-y divide-slate-100">
              {cells.map((cell) => {
                const item = byProject
                  ? data.drivers.find((d) => d.id === cell.driver_id)!
                  : data.projects.find((p) => p.id === cell.project_id)!;
                return (
                  <li key={`${cell.project_id}:${cell.driver_id}`}>
                    <Link
                      href={ledgerHref(query, cell)}
                      className="flex min-h-11 flex-wrap items-center justify-between gap-3 rounded-md py-4 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-700"
                    >
                      <div className="min-w-0 break-words">
                        <p className="font-semibold text-blue-800 underline underline-offset-4">
                          {item.name}
                        </p>
                        {byProject && (
                          <p className="mt-1 text-sm text-slate-600">
                            {data.drivers
                              .find((driver) => driver.id === cell.driver_id)!
                              .affiliations.join(', ') || '소속 정보 없음'}
                          </p>
                        )}
                        <p className="mt-1 text-sm text-slate-600">
                          운행 {cell.count.toLocaleString('ko-KR')}건
                        </p>
                      </div>
                      <Amount value={cell} pending={pending} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </article>
        );
      })}
    </div>
  );
}
function SummaryTable({ data, query }: { data: SummaryResult; query: Query }) {
  const pending = data.include === 'all';
  const cells = new Map(data.cells.map((cell) => [`${cell.project_id}:${cell.driver_id}`, cell]));
  const cellClass = 'min-w-40 border-b border-slate-200 px-4 py-3 text-right align-top';
  const firstClass =
    'sticky left-0 z-10 min-w-40 max-w-56 border-r border-b border-slate-200 bg-white px-4 py-3 text-left break-words';
  return (
    <div
      className="min-w-0 overflow-x-auto rounded-lg border border-slate-200 bg-white"
      role="region"
      aria-label="현장·기사별 금액 표"
      tabIndex={0}
    >
      <table className="w-full border-separate border-spacing-0 text-sm tabular-nums">
        <caption className="sr-only">기사별 현장 승인 공급가. 검수 전 금액은 별도 표시합니다.</caption>
        <thead>
          <tr>
            <th scope="col" className={firstClass}>
              기사 / 현장
            </th>
            {data.projects.map((project) => (
              <th scope="col" key={project.id} className={`${cellClass} bg-slate-50`}>
                {project.name}
              </th>
            ))}
            <th scope="col" className={`${cellClass} bg-slate-100`}>
              기사 합계
            </th>
          </tr>
        </thead>
        <tbody>
          {data.drivers.map((driver) => (
            <tr key={driver.id}>
              <th scope="row" className={firstClass}>
                {driver.name}
                <span className="mt-1 block font-normal text-slate-600">
                  {driver.affiliations.join(', ') || '소속 정보 없음'}
                </span>
              </th>
              {data.projects.map((project) => {
                const cell = cells.get(`${project.id}:${driver.id}`);
                return (
                  <td key={project.id} className={cellClass}>
                    {cell && (
                      <Link
                        className="block min-h-11 rounded-md hover:bg-slate-50"
                        href={ledgerHref(query, cell)}
                        aria-label={`${driver.name} · ${project.name} 사용대장`}
                      >
                        <Amount value={cell} pending={pending} blankZero />
                      </Link>
                    )}
                  </td>
                );
              })}
              <td className={`${cellClass} bg-slate-50`}>
                <Amount value={driver} pending={pending} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className={firstClass}>
              현장 합계
            </th>
            {data.projects.map((project) => (
              <td key={project.id} className={`${cellClass} bg-slate-50`}>
                <Amount value={project} pending={pending} />
              </td>
            ))}
            <td className={`${cellClass} bg-slate-100`}>
              <Amount value={data.totals} pending={pending} />
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
export function Summary({ initial }: { initial: Record<string, string> }) {
  return (
    <ClosingPeriodLoader>
      {(settings) => <SummaryContent initial={initial} settings={settings} />}
    </ClosingPeriodLoader>
  );
}
function SummaryContent({
  initial,
  settings,
}: {
  initial: Record<string, string>;
  settings: ClosingPeriodSettings;
}) {
  const { today, closing_start_day: startDay } = settings;
  const defaults = {
    ...closingPeriod(today, startDay),
    include: 'approved',
    view: 'projects',
    project_id: '',
    driver_id: '',
    payee_counterparty_id: '',
    detail: '',
    sort: 'date',
  };
  const readQuery = (input: Record<string, string>): Query => ({
    from: input.from ?? defaults.from,
    to: input.to ?? defaults.to,
    include: input.include ?? defaults.include,
    view: ['projects', 'drivers', 'table'].includes(input.view) ? input.view : 'projects',
    project_id: input.project_id ?? '',
    driver_id: input.driver_id ?? '',
    payee_counterparty_id: input.payee_counterparty_id ?? '',
    detail: input.detail ?? '',
    sort: input.sort ?? 'date',
  });
  const [query, setQuery] = useState<Query>(() => readQuery(initial));
  const [draft, setDraft] = useState(() => ({ from: query.from, to: query.to }));
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const apiQuery = new URLSearchParams({
    from: query.from,
    to: query.to,
    include: query.include,
    project_id: query.project_id,
    driver_id: query.driver_id,
    payee_counterparty_id: query.payee_counterparty_id,
    sort: query.sort,
  }).toString();
  const { data, loading, error, refresh } = useRemote<SummaryResult>(`/api/summary?${apiQuery}`);
  useEffect(() => {
    const defaults = {
      ...closingPeriod(today, startDay),
      include: 'approved',
      view: 'projects',
      project_id: '',
      driver_id: '',
      payee_counterparty_id: '',
      detail: '',
      sort: 'date',
    };
    const current = { ...defaults, ...Object.fromEntries(new URLSearchParams(window.location.search)) };
    window.history.replaceState(null, '', `/m/summary?${queryString(current)}`);
    const restore = () => {
      const params = Object.fromEntries(new URLSearchParams(window.location.search));
      const next = { ...defaults, ...params };
      setQuery(next);
      setDraft({ from: next.from, to: next.to });
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [today, startDay]);
  const change = (next: Query) => {
    setQuery(next);
    setDraft({ from: next.from, to: next.to });
    setExportError('');
    window.history.pushState(null, '', `/m/summary?${queryString(next)}`);
  };
  const download = async (trade = false) => {
    setExporting(true);
    setExportError('');
    try {
      const response = await fetch(`/api/summary/${trade ? 'trade' : 'export'}.xlsx?${apiQuery}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error?.message ?? '엑셀을 받지 못했습니다. 다시 시도해 주세요.');
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${trade ? '거래명세표' : '현장기사별집계'}_${query.from}_${query.to}.xlsx`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) {
      setExportError(
        reason instanceof Error ? reason.message : '엑셀을 받지 못했습니다. 다시 시도해 주세요.',
      );
    } finally {
      setExporting(false);
    }
  };
  return (
    <div className="min-w-0">
      <Heading
        title="현장·기사별 집계"
        description="선택한 기간의 현장별·기사별 운행과 지급 금액을 확인합니다."
      >
        <button
          type="button"
          className={secondaryClass}
          disabled={exporting || loading || !data}
          onClick={() => download()}
        >
          엑셀로 받기
        </button>
        <button
          type="button"
          className={secondaryClass}
          disabled={exporting || loading || !data}
          onClick={() => download(true)}
        >
          거래명세표 엑셀
        </button>
      </Heading>
      <section aria-label="조회 조건" className={`${panelClass} mb-5`}>
        <div className="mb-4">
          <ClosingPeriodButtons settings={settings} onChange={(period) => change({ ...query, ...period })} />
        </div>
        <form
          className="grid min-w-0 items-end gap-3 sm:grid-cols-[1fr_1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            change({ ...query, ...draft });
          }}
        >
          <Field title="시작일">
            <input
              className={inputClass}
              type="date"
              required
              value={draft.from}
              onChange={(event) => setDraft({ ...draft, from: event.target.value })}
            />
          </Field>
          <Field title="종료일">
            <input
              className={inputClass}
              type="date"
              required
              value={draft.to}
              onChange={(event) => setDraft({ ...draft, to: event.target.value })}
            />
          </Field>
          <button className={buttonClass} type="submit">
            조회하기
          </button>
        </form>
        <p className="mt-2 text-sm text-slate-600">
          회사 마감일 기준으로 빠르게 고르거나 기간을 직접 입력하세요. 최대 1년까지 조회합니다.
        </p>
        <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
          <Field title="지급처">
            <select
              className={inputClass}
              aria-label="지급처"
              value={query.payee_counterparty_id}
              onChange={(e) => change({ ...query, payee_counterparty_id: e.target.value })}
            >
              <option value="">전체 지급처</option>
              {data?.options.payees.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field title="현장">
            <select
              className={inputClass}
              aria-label="현장"
              value={query.project_id}
              onChange={(e) => change({ ...query, project_id: e.target.value })}
            >
              <option value="">전체 현장</option>
              {data?.options.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="포함 기준">
          {[
            ['approved', '승인된 금액만'],
            ['all', '검수 전 포함'],
          ].map(([value, title]) => (
            <button
              key={value}
              className={query.include === value ? buttonClass : secondaryClass}
              aria-pressed={query.include === value}
              onClick={() => change({ ...query, include: value })}
            >
              {title}
            </button>
          ))}
        </div>
      </section>
      <Notice error={error} onRetry={refresh} />
      <Notice error={exportError} />
      {loading && <Empty loading />}
      {data && (
        <>
          <div className="mb-5 grid min-w-0 gap-3 lg:grid-cols-3" aria-label="집계 요약">
            <section className={panelClass}>
              <h2 className="text-sm text-slate-600">전체 합계 (부가세 별도)</h2>
              <div className="mt-2 text-xl">
                <Amount value={data.totals} pending={data.include === 'all'} />
              </div>
              <p className="mt-2 text-right text-sm text-slate-600 tabular-nums">
                부가세 포함 {money(data.totals.grand_total)}
              </p>
            </section>
            <section className={panelClass}>
              <h2 className="text-sm text-slate-600">운행 건수</h2>
              <p className="mt-2 text-2xl font-bold tabular-nums">
                {data.totals.count.toLocaleString('ko-KR')}건
              </p>
            </section>
            <section className={panelClass}>
              <h2 className="text-sm text-slate-600">기사 수 · 현장 수</h2>
              <p className="mt-2 text-2xl font-bold tabular-nums">
                {data.totals.driver_count}명 · {data.totals.project_count}곳
              </p>
            </section>
          </div>
          <p className="mb-4 text-sm text-slate-600">
            금액은 담당자가 승인한 금액(부가세 별도)입니다. 취소된 운행과 보류·반려된 비용은 빠집니다.
            {data.include === 'all' && ' 회색 금액은 아직 승인 전 금액이라 합계에 넣지 않았습니다.'} 이름을
            누르면 사용대장을 엽니다.
          </p>
          <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="보기 전환">
            {[
              ['projects', '현장별'],
              ['drivers', '기사별'],
              ['table', '한눈에 표'],
            ].map(([value, title]) => (
              <button
                key={value}
                className={query.view === value ? buttonClass : secondaryClass}
                aria-pressed={query.view === value}
                onClick={() => change({ ...query, view: value })}
              >
                {title}
              </button>
            ))}
          </div>
          {query.detail && (
            <SummaryDetail
              data={data}
              driverId={query.driver_id}
              sort={query.sort}
              onDriver={(id) => change({ ...query, driver_id: id })}
              onSort={(sort) => change({ ...query, sort })}
              onClose={() => change({ ...query, detail: '', driver_id: '' })}
              onExport={() => download(true)}
              exporting={exporting}
            />
          )}
          {data.cells.length === 0 ? (
            <div className={panelClass}>
              <Empty>선택한 기간에 해당하는 운행이 없습니다. 기간이나 포함 기준을 바꿔 보세요.</Empty>
            </div>
          ) : query.view === 'table' ? (
            <SummaryTable data={data} query={query} />
          ) : (
            <SummaryCards
              data={data}
              query={query}
              onDetail={(id, byProject) => {
                change({
                  ...query,
                  detail: byProject ? 'project' : 'driver',
                  ...(byProject ? { project_id: id, driver_id: '' } : { driver_id: id }),
                });
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
