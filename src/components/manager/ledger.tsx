'use client';
import { useEffect, useState } from 'react';
import type { LedgerResult, LedgerRow } from '@/server/services/ledger';
import {
  Badge,
  Empty,
  Field,
  Heading,
  Notice,
  Pager,
  UseLink,
  inputClass,
  label,
  money,
  panelClass,
  secondaryClass,
  buttonClass,
  useRemote,
  api,
  mutate,
  signalClass,
} from './common';
import { Plate } from '@/components/ui/plate';
type Option = { id: string; name?: string; plate_no?: string; active?: boolean };
type Options = { projects: Option[]; drivers: Option[]; vehicles: Option[]; counterparties: Option[] };
export type Search = Record<string, string>;
export function queryString(query: Search) {
  return new URLSearchParams(Object.entries(query).filter(([, value]) => Boolean(value))).toString();
}
const columns: { key: keyof LedgerRow; title: string; render?: (row: LedgerRow) => React.ReactNode }[] = [
  { key: 'use_no', title: '사용번호', render: (row) => <UseLink id={row.id}>{row.use_no}</UseLink> },
  { key: 'use_date', title: '사용일' },
  { key: 'project_name', title: '현장' },
  { key: 'work_type_name', title: '공종' },
  { key: 'requester', title: '요청자' },
  { key: 'driver_name', title: '기사' },
  { key: 'plate_no', title: '차량', render: (row) => <Plate value={row.plate_no} size="sm" /> },
  { key: 'payee_name', title: '운송사/지급처' },
  {
    key: 'route_summary',
    title: '경로',
    render: (row) => <span className="block max-w-64 break-words">{row.route_summary}</span>,
  },
  { key: 'cargo_desc', title: '운반 내용' },
  {
    key: 'billing_units',
    title: '계약단위',
    render: (row) => (row.billing_units ?? []).map(label).join(', ') || '—',
  },
  { key: 'performance', title: '실적' },
  { key: 'base_amount', title: '기본비', render: (row) => money(row.base_amount) },
  { key: 'extra_amount', title: '추가비', render: (row) => money(row.extra_amount) },
  {
    key: 'total_amount',
    title: '합계',
    render: (row) => <strong className="num whitespace-nowrap">{money(row.total_amount)}</strong>,
  },
  {
    key: 'evidence_count',
    title: '증빙',
    render: (row) => (
      <span className={row.evidence_missing ? 'font-semibold text-amber-800' : ''}>
        {row.evidence_count}개 {row.evidence_missing && '· 필수 누락'}
      </span>
    ),
  },
  {
    key: 'review_status',
    title: '검수상태',
    render: (row) => <Badge value={row.operation_status === 'CANCELED' ? 'CANCELED' : row.review_status} />,
  },
  { key: 'statement_numbers', title: '정산회차' },
  { key: 'settlement_status', title: '정산상태', render: (row) => label(row.settlement_status) },
  { key: 'payment_status', title: '지급상태', render: (row) => label(row.payment_status) },
];
const defaults: Search = { page: '1', pageSize: '20', sort: 'use_date', order: 'desc' };
const defaultColumns: (keyof LedgerRow)[] = [
  'use_no',
  'use_date',
  'project_name',
  'driver_name',
  'plate_no',
  'route_summary',
  'total_amount',
  'review_status',
  'settlement_status',
  'payment_status',
];
const mobileCoreColumns: (keyof LedgerRow)[] = [
  'use_date',
  'project_name',
  'driver_name',
  'plate_no',
  'total_amount',
  'review_status',
];
function LedgerCard({ row, visible }: { row: LedgerRow; visible: (keyof LedgerRow)[] }) {
  const selected = columns.filter((column) => column.key !== 'use_no' && visible.includes(column.key));
  const core = selected.filter((column) => mobileCoreColumns.includes(column.key));
  const more = selected.filter((column) => !mobileCoreColumns.includes(column.key));
  const fields = (items: typeof columns) => (
    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
      {items.map((column) => (
        <div key={column.key} className={`min-w-0 ${column.key === 'route_summary' ? 'col-span-2' : ''}`}>
          <dt className="text-xs text-slate-600">{column.title}</dt>
          <dd className="mt-1 break-words font-medium">
            {column.render ? column.render(row) : String(row[column.key] || '—')}
          </dd>
        </div>
      ))}
    </dl>
  );
  return (
    <article className={panelClass}>
      <UseLink id={row.id}>{row.use_no}</UseLink>
      {fields(core)}
      {more.length > 0 && (
        <details className="mt-3 border-t border-slate-100 pt-2">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-blue-700">
            더 보기
          </summary>
          {fields(more)}
        </details>
      )}
    </article>
  );
}
export function Ledger({ initial = {} }: { initial?: Search }) {
  const [query, setQuery] = useState<Search>({ ...defaults, ...initial });
  const [draft, setDraft] = useState(query);
  const [visible, setVisible] = useState(defaultColumns);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterCount = Object.entries(query).filter(
    ([key, value]) => value && !['page', 'pageSize', 'sort', 'order'].includes(key),
  ).length;
  const advancedKeys = [
    'period',
    'driver_id',
    'vehicle_id',
    'counterparty_id',
    'review_status',
    'settlement_status',
    'payment_status',
  ];
  const advancedCount = advancedKeys.filter((key) => query[key]).length;
  const [moreOpen, setMoreOpen] = useState(advancedCount > 0);
  useEffect(() => {
    // Mobile cards expose all columns; desktop starts with its compact table selection.
    if (window.matchMedia('(max-width: 767px)').matches) setVisible(columns.map((column) => column.key));
    const restore = () => {
      const next = { ...defaults, ...Object.fromEntries(new URLSearchParams(window.location.search)) };
      setQuery(next);
      setDraft(next);
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  const { data, error, loading, refresh } = useRemote<LedgerResult>(`/api/ledger?${queryString(query)}`);
  const lookups = useRemote<Options>('/api/ledger/options');
  const change = (next: Search) => {
    setQuery(next);
    window.history.pushState(null, '', `/m/ledger?${queryString(next)}`);
  };
  const draftValue = (key: string, value: string) => setDraft((previous) => ({ ...previous, [key]: value }));
  const optionField = (title: string, key: string, options: Option[]) => (
    <Field title={title}>
      <select
        className={inputClass}
        value={draft[key] ?? ''}
        onChange={(event) => draftValue(key, event.target.value)}
      >
        <option value="">전체</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name ?? option.plate_no}
            {option.active === false ? ' (사용 중지)' : ''}
          </option>
        ))}
      </select>
    </Field>
  );
  const statusField = (title: string, key: string, values: string[]) =>
    optionField(
      title,
      key,
      values.map((value) => ({ id: value, name: label(value) })),
    );
  return (
    <>
      <Heading title="차량 사용대장" description="사용일과 명세의 정산기간을 구분하여 조회합니다.">
        <a className={secondaryClass} href={`/api/ledger/export.xlsx?${queryString(query)}`}>
          검색 결과 전체 엑셀
        </a>
      </Heading>
      <button
        type="button"
        className={`${secondaryClass} mb-3 w-full justify-between md:hidden`}
        aria-expanded={filtersOpen}
        aria-controls="ledger-filters"
        onClick={() => setFiltersOpen(!filtersOpen)}
      >
        <span>
          필터{filterCount > 0 ? ` (${filterCount})` : ''} {filtersOpen ? '접기 −' : '펼치기 +'}
        </span>
      </button>
      <form
        id="ledger-filters"
        className={`${panelClass} mb-5 ${filtersOpen ? 'block' : 'hidden'} md:block`}
        onSubmit={(event) => {
          event.preventDefault();
          change({ ...draft, page: '1' });
          setFiltersOpen(false);
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field title="검색어">
            <input
              className={inputClass}
              placeholder="사용번호·기사·차량·경로"
              value={draft.search ?? ''}
              onChange={(e) => draftValue('search', e.target.value)}
            />
          </Field>
          {optionField('현장', 'project_id', lookups.data?.projects ?? [])}
          <Field title="사용일 시작">
            <input
              type="date"
              className={inputClass}
              value={draft.from ?? ''}
              onChange={(e) => draftValue('from', e.target.value)}
            />
          </Field>
          <Field title="사용일 종료">
            <input
              type="date"
              className={inputClass}
              value={draft.to ?? ''}
              onChange={(e) => draftValue('to', e.target.value)}
            />
          </Field>
        </div>
        {moreOpen && (
          <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field title="정산월 (포함 명세 기간)">
              <input
                type="month"
                className={inputClass}
                value={draft.period ?? ''}
                onChange={(e) => draftValue('period', e.target.value)}
              />
            </Field>
            {optionField('기사', 'driver_id', lookups.data?.drivers ?? [])}
            {optionField('차량', 'vehicle_id', lookups.data?.vehicles ?? [])}
            {optionField('운송사/지급처', 'counterparty_id', lookups.data?.counterparties ?? [])}
            {statusField('검수상태', 'review_status', ['DRAFT', 'SUBMITTED', 'NEEDS_FIX', 'APPROVED'])}
            {statusField('정산상태', 'settlement_status', ['UNSETTLED', 'PARTIAL', 'SETTLED'])}
            {statusField('지급상태', 'payment_status', ['NOT_SETTLED', 'UNPAID', 'PARTIAL', 'PAID'])}
            <Field title="정렬">
              <select
                className={inputClass}
                value={`${draft.sort}:${draft.order}`}
                onChange={(e) => {
                  const [sort, order] = e.target.value.split(':');
                  setDraft({ ...draft, sort, order });
                }}
              >
                {[
                  ['use_date:desc', '사용일 최신순'],
                  ['use_date:asc', '사용일 오래된순'],
                  ['use_no:desc', '사용번호 역순'],
                  ['total_amount:desc', '승인액 높은순'],
                  ['total_amount:asc', '승인액 낮은순'],
                  ['project_name:asc', '현장 이름순'],
                  ['driver_name:asc', '기사 이름순'],
                ].map(([value, title]) => (
                  <option key={value} value={value}>
                    {title}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className={buttonClass}>조회</button>
          <button
            type="button"
            className={secondaryClass}
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(!moreOpen)}
          >
            {moreOpen ? '상세 필터 접기' : `상세 필터${advancedCount ? ` (${advancedCount})` : ''}`}
          </button>
          <button
            type="button"
            className={secondaryClass}
            onClick={() => {
              const next = { page: '1', pageSize: '20', sort: 'use_date', order: 'desc' };
              setDraft(next);
              change(next);
            }}
          >
            초기화
          </button>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.evidence_missing === 'true'}
              onChange={(e) => draftValue('evidence_missing', e.target.checked ? 'true' : '')}
            />
            필수 증빙 누락
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.unsettled_approved === 'true'}
              onChange={(e) => draftValue('unsettled_approved', e.target.checked ? 'true' : '')}
            />
            미정산 승인 건
          </label>
        </div>
      </form>
      <Notice
        error={error || lookups.error}
        onRetry={() => {
          refresh();
          lookups.refresh();
        }}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className={panelClass}>
          <p className="text-sm text-slate-600">현재 페이지 합계</p>
          <strong className="mt-2 block text-xl">{data ? money(data.totals.pageSum) : '—'}</strong>
        </div>
        <div className={`${panelClass} border-blue-200 bg-blue-50`}>
          <p className="text-sm text-slate-600">전체 검색 결과 합계{data ? `(${data.total}건)` : ''}</p>
          <strong className="mt-2 block text-xl">{data ? money(data.totals.filteredSum) : '—'}</strong>
        </div>
      </div>
      <p className="mb-3 text-xs text-slate-600">
        기본비·추가비·합계는 지급 승인 공급가입니다. 승인액이 없는 항목은 미확정으로 표시하며 합계에서
        제외합니다. 취소 건은 합계에서 제외합니다. 엑셀에는 현재 필터의 전체 행·전체 열이 포함됩니다.
      </p>
      <details className={`${panelClass} mb-3`}>
        <summary className="cursor-pointer text-sm font-semibold">표시 열 선택</summary>
        <div className="mt-3 flex flex-wrap gap-4">
          {columns.map((column) => (
            <label key={column.key} className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={visible.includes(column.key)}
                disabled={column.key === 'use_no'}
                onChange={(e) =>
                  setVisible((previous) =>
                    e.target.checked
                      ? [...previous, column.key]
                      : previous.filter((key) => key !== column.key),
                  )
                }
              />
              {column.title}
            </label>
          ))}
        </div>
      </details>
      <div
        className="hidden max-w-full overflow-x-auto rounded-xl border border-slate-200 bg-white md:block"
        aria-busy={loading}
      >
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-slate-100 text-xs text-slate-600">
            <tr>
              {columns
                .filter((c) => visible.includes(c.key))
                .map((c) => (
                  <th className="whitespace-nowrap px-2 py-3" key={c.key}>
                    {c.title}
                  </th>
                ))}
            </tr>
          </thead>
          <tbody>
            {!loading &&
              data?.rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50">
                  {columns
                    .filter((c) => visible.includes(c.key))
                    .map((c) => (
                      <td
                        key={c.key}
                        className={`max-w-64 px-2 py-3 ${['use_no', 'use_date'].includes(c.key) ? 'whitespace-nowrap' : ''}`}
                      >
                        {c.render ? c.render(row) : String(row[c.key] ?? '—')}
                      </td>
                    ))}
                </tr>
              ))}
          </tbody>
        </table>
        {(loading || (data && !data.rows.length)) && <Empty loading={loading} />}
      </div>
      <div className="grid gap-3 md:hidden" aria-label="사용대장 카드 목록" aria-busy={loading}>
        {!loading && data?.rows.map((row) => <LedgerCard key={row.id} row={row} visible={visible} />)}
        {(loading || (data && !data.rows.length)) && <Empty loading={loading} />}
      </div>
      <div className="mt-4 flex justify-end">
        <Field title="페이지 크기">
          <select
            className={inputClass}
            value={query.pageSize}
            onChange={(e) => {
              const next = { ...query, page: '1', pageSize: e.target.value };
              setDraft({ ...draft, pageSize: e.target.value });
              change(next);
            }}
          >
            {[10, 20, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size}건
              </option>
            ))}
          </select>
        </Field>
      </div>
      {data && (
        <Pager
          page={Number(query.page)}
          pageSize={Number(query.pageSize)}
          total={data.total}
          onChange={(page) => change({ ...query, page: String(page) })}
        />
      )}
    </>
  );
}
const reviewTabs = [
  ['SUBMITTED', '검수 대기'],
  ['NEEDS_FIX', '보완 요청'],
  ['MISSING', '증빙 누락'],
] as const;

/** 증빙·단가·추가비 요청에 걸리는 것이 없으면 목록에서 바로 승인할 수 있다. */
function quickApprovable(row: LedgerRow) {
  return (
    row.review_status === 'SUBMITTED' &&
    row.operation_status !== 'CANCELED' &&
    !row.evidence_missing &&
    !row.has_requested_extra &&
    !row.has_base_amount_difference &&
    row.review_total_amount !== null
  );
}

async function approveUse(id: string) {
  const detail = await api<{ version: number }>(`/api/uses/${id}`);
  await mutate(`/api/uses/${id}/approve`, 'POST', { version: detail.version });
}

type CardResult = 'approved' | { error: string } | undefined;

function ReviewCard({
  row,
  result,
  selected,
  onToggle,
  onResult,
}: {
  row: LedgerRow;
  result: CardResult;
  selected: boolean;
  onToggle: () => void;
  onResult: (result: CardResult) => void;
}) {
  const [busy, setBusy] = useState(false);
  const approved = result === 'approved';
  const error = typeof result === 'object' ? result.error : '';
  const [day, month] = [row.use_date.slice(8, 10), Number(row.use_date.slice(5, 7))];
  const quick = quickApprovable(row) && !approved;
  const issues = [
    row.evidence_missing && '증빙 없음',
    row.has_requested_extra && '요청 추가비 확인 필요',
    row.has_base_amount_difference && '계약 단가와 다른 금액',
    row.review_total_amount === null && '단가 미확정',
    row.entered_as === 'PROXY' && `대리 입력(${row.creator_name})`,
  ].filter(Boolean) as string[];
  async function approve() {
    setBusy(true);
    try {
      await approveUse(row.id);
      onResult('approved');
    } catch (reason) {
      onResult({ error: reason instanceof Error ? reason.message : '승인하지 못했습니다.' });
    } finally {
      setBusy(false);
    }
  }
  return (
    <article
      className={`flex overflow-hidden rounded-lg border bg-white ${approved ? 'border-emerald-300 bg-emerald-50/40' : selected ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-200'}`}
    >
      {quick ? (
        <label className="flex w-10 shrink-0 cursor-pointer items-center justify-center border-r border-slate-100 sm:w-12">
          <input
            type="checkbox"
            className="h-5 w-5 accent-blue-700"
            checked={selected}
            onChange={onToggle}
            aria-label={`${row.use_no} 선택`}
          />
        </label>
      ) : (
        <span aria-hidden="true" className="w-10 shrink-0 border-r border-slate-100 sm:w-12" />
      )}
      <div className="flex w-12 shrink-0 flex-col items-center justify-center py-3 sm:w-16">
        <span className="text-xs text-slate-500">{month}월</span>
        <span className="num text-2xl leading-none font-bold sm:text-[1.75rem]">{day}</span>
      </div>
      <div className="slip-perforation w-2 shrink-0" aria-hidden="true" />
      <div className="grid min-w-0 flex-1 gap-3 p-3 sm:grid-cols-[1fr_auto] sm:items-center sm:p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Plate value={row.plate_no} />
            <span className="font-semibold">{row.driver_name}</span>
            <span className="text-sm text-slate-500">{row.project_name}</span>
          </div>
          <p className="mt-1.5 truncate text-[0.9375rem]">
            {row.route_summary}
            {/* 조출·장재물 같은 운반 내용은 금액이 달라지는 이유라 함께 보여 준다. */}
            {row.cargo_desc && <span className="text-slate-500"> · {row.cargo_desc}</span>}
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <UseLink id={row.id}>{row.use_no}</UseLink>
            <span className="text-slate-600">증빙 {row.evidence_count}개</span>
            {issues.map((issue) => (
              <span key={issue} className="font-semibold text-orange-700">
                {issue}
              </span>
            ))}
          </p>
          {error && (
            <p role="alert" className="mt-2 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 sm:flex-col sm:flex-nowrap sm:items-end">
          <div className="sm:text-right">
            <p className="num text-lg font-bold whitespace-nowrap">{money(row.review_total_amount)}</p>
            {(row.review_extra_amount ?? 0) > 0 && (
              <p className="num text-xs text-slate-600">
                기본 {money(row.review_base_amount)} + 추가비 {money(row.review_extra_amount)}
              </p>
            )}
          </div>
          {approved ? (
            <span className="font-bold text-emerald-700">승인됨</span>
          ) : quick ? (
            <div className="ml-auto flex gap-2 sm:ml-0">
              <a className={secondaryClass} href={`/m/uses/${row.id}`}>
                열기
              </a>
              <button type="button" className={signalClass} disabled={busy} onClick={approve}>
                {busy ? '승인 중…' : '바로 승인'}
              </button>
            </div>
          ) : (
            <a className={buttonClass} href={`/m/uses/${row.id}`}>
              확인하기
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

export function ReviewInbox({ initialTab = 'SUBMITTED' }: { initialTab?: string }) {
  const [tab, setTab] = useState(
    ['SUBMITTED', 'NEEDS_FIX', 'MISSING'].includes(initialTab) ? initialTab : 'SUBMITTED',
  );
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, CardResult>>({});
  const [bulkBusy, setBulkBusy] = useState(false);
  const filter = tab === 'MISSING' ? 'evidence_missing=true' : `review_status=${tab}`;
  const { data, error, loading, refresh } = useRemote<LedgerResult>(
    `/api/ledger?${filter}&page=${page}&pageSize=20&sort=use_date&order=asc`,
  );
  const quickRows = data?.rows.filter((row) => quickApprovable(row) && results[row.id] !== 'approved') ?? [];
  const chosen = quickRows.filter((row) => selected.has(row.id));
  const chosenTotal = chosen.reduce((sum, row) => sum + (row.review_total_amount ?? 0), 0);
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  async function approveSelected() {
    setBulkBusy(true);
    for (const row of chosen) {
      try {
        await approveUse(row.id);
        setResults((current) => ({ ...current, [row.id]: 'approved' }));
      } catch (reason) {
        setResults((current) => ({
          ...current,
          [row.id]: { error: reason instanceof Error ? reason.message : '승인하지 못했습니다.' },
        }));
      }
    }
    setSelected(new Set());
    setBulkBusy(false);
  }
  return (
    <div className={chosen.length ? 'pb-24' : undefined}>
      <Heading
        title="검수함"
        description={
          tab === 'SUBMITTED' && data
            ? quickRows.length
              ? `문제없는 ${quickRows.length}건은 바로 승인할 수 있습니다.`
              : '확인이 필요한 건만 남았습니다.'
            : undefined
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label="검수 목록"
          className="flex gap-1 overflow-x-auto rounded-lg bg-slate-200/70 p-1"
        >
          {reviewTabs.map(([value, title]) => (
            <button
              key={value}
              type="button"
              aria-pressed={tab === value}
              className={`min-h-10 whitespace-nowrap rounded-md px-4 text-sm font-semibold sm:px-5 ${tab === value ? 'bg-white text-ink shadow-sm' : 'text-slate-600 hover:text-ink'}`}
              onClick={() => {
                setTab(value);
                setPage(1);
                setSelected(new Set());
                window.history.replaceState(null, '', `/m/review?tab=${value}`);
              }}
            >
              {title}
            </button>
          ))}
        </div>
        {quickRows.length > 1 && (
          <button
            type="button"
            className={secondaryClass}
            onClick={() =>
              setSelected(
                chosen.length === quickRows.length ? new Set() : new Set(quickRows.map((row) => row.id)),
              )
            }
          >
            {chosen.length === quickRows.length ? '선택 해제' : `문제없는 ${quickRows.length}건 모두 선택`}
          </button>
        )}
      </div>
      <Notice error={error} onRetry={error ? refresh : undefined} />
      <div className="grid gap-2.5">
        {!loading &&
          data?.rows.map((row) => (
            <ReviewCard
              key={row.id}
              row={row}
              result={results[row.id]}
              selected={selected.has(row.id)}
              onToggle={() => toggle(row.id)}
              onResult={(result) => setResults((current) => ({ ...current, [row.id]: result }))}
            />
          ))}
      </div>
      {(loading || (data && !data.rows.length)) && (
        <Empty loading={loading}>
          {tab === 'SUBMITTED' ? '검수할 운행이 없습니다. 모두 처리했습니다.' : '해당하는 운행이 없습니다.'}
        </Empty>
      )}
      {data && data.total > 20 && <Pager page={page} pageSize={20} total={data.total} onChange={setPage} />}
      {chosen.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:left-60">
          <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3">
            <p className="text-sm">
              <span className="font-bold">{chosen.length}건 선택</span>
              <span className="num ml-2 text-base font-bold">{money(chosenTotal)}</span>
            </p>
            <button
              type="button"
              className={`${signalClass} min-h-12 px-6 text-base`}
              disabled={bulkBusy}
              onClick={approveSelected}
            >
              {bulkBusy ? '승인 중…' : `선택 ${chosen.length}건 승인`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
