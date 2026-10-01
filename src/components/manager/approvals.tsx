'use client';
import { useRef, useState } from 'react';
import type { LedgerRow } from '@/server/services/ledger';
import type { getApprovals } from '@/server/services/approvals';
import { approvalLabels, approvalStatuses } from '@/shared/approvals';
import { ApprovalDates, ApprovalSelect, ApprovalTabs, useApprovalQuery } from '../approval-filters';
import { approveUse, quickApprovable } from './quick-approval';
import {
  Empty,
  Heading,
  Notice,
  Pager,
  inputClass,
  money,
  panelClass,
  secondaryClass,
  signalClass,
  useRemote,
} from './common';
type Data = Omit<Awaited<ReturnType<typeof getApprovals>>, 'rows'> & { rows: LedgerRow[] };

export function Approvals() {
  const { query, search, change } = useApprovalQuery();
  const { data, error, loading, refresh } = useRemote<Data>(`/api/approvals?${search}`);
  const [selection, setSelection] = useState<{ search: string; ids: string[] }>({ search: '', ids: [] });
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [message, setMessage] = useState('');
  const [failures, setFailures] = useState('');
  const rows = data?.rows ?? [];
  const selected = selection.search === search ? selection.ids : [];
  const quickRows = rows.filter(quickApprovable);
  const chosen = quickRows.filter((r) => selected.includes(r.id));
  const toggle = (id: string) =>
    setSelection({
      search,
      ids: selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id],
    });
  async function approve(targets: LedgerRow[]) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    setFailures('');
    let count = 0;
    const errors: string[] = [];
    for (const row of targets) {
      try {
        await approveUse(row.id);
        count++;
      } catch (reason) {
        errors.push(`${row.use_no}: ${reason instanceof Error ? reason.message : '승인하지 못했습니다.'}`);
      }
    }
    setMessage(`${count}건 승인했습니다.`);
    setFailures(errors.join(' / '));
    setSelection({ search, ids: [] });
    setBusy(false);
    lock.current = false;
    refresh();
  }
  function filter(key: string) {
    if (key === 'date') return <ApprovalDates from={query.from} to={query.to} onChange={change} />;
    if (key === 'transport')
      return (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const value = new FormData(e.currentTarget).get('transport');
            change({ transport_search: String(value ?? '') });
          }}
          className="grid gap-2"
        >
          <input
            key={query.transport_search ?? ''}
            aria-label="운송내역 검색"
            name="transport"
            defaultValue={query.transport_search ?? ''}
            placeholder="출발·도착·운반 내용"
            maxLength={100}
            className={inputClass}
          />
          <button className={secondaryClass}>검색</button>
        </form>
      );
    if (key === 'status')
      return (
        <select
          aria-label="진행상태"
          className={inputClass}
          value={query.review_status || ''}
          onChange={(e) => change({ review_status: e.target.value })}
        >
          {approvalStatuses.map((v) => (
            <option key={v} value={v === 'ALL' ? '' : v}>
              {approvalLabels[v]}
            </option>
          ))}
        </select>
      );
    const field = key === 'project' ? 'project_id' : key === 'driver' ? 'driver_id' : 'reviewer_user_id';
    const options =
      key === 'project'
        ? data?.options.projects
        : key === 'driver'
          ? data?.options.drivers
          : data?.options.reviewers;
    const title = key === 'project' ? '프로젝트' : key === 'driver' ? '기사명' : '담당자';
    return (
      <div className="grid gap-2">
        <ApprovalSelect
          title={title}
          value={query[field]}
          options={options ?? []}
          onChange={(value) => change({ [field]: value })}
        />
        {key === 'reviewer' && (
          <div className="flex flex-wrap gap-1">
            <button type="button" className={secondaryClass} onClick={() => change({ reviewer_user_id: '' })}>
              전체
            </button>
            <button
              type="button"
              className={secondaryClass}
              onClick={() => change({ reviewer_user_id: 'me' })}
            >
              나
            </button>
          </div>
        )}
      </div>
    );
  }
  const filters = [
    ['date', '운송일자'],
    ['transport', '운송내역'],
    ['project', '프로젝트'],
    ['driver', '기사명'],
    ['reviewer', '담당자'],
    ['status', '진행상태'],
  ];
  const status = (row: LedgerRow) =>
    row.operation_status === 'CANCELED' ? '취소' : approvalLabels[row.review_status];
  const select = (row: LedgerRow) =>
    quickApprovable(row) && (
      <label className="inline-flex min-h-11 min-w-11 items-center justify-center">
        <input
          type="checkbox"
          className="h-5 w-5"
          aria-label={`${row.use_no} 선택`}
          checked={selected.includes(row.id)}
          disabled={busy}
          onChange={() => toggle(row.id)}
        />
      </label>
    );
  const action = (row: LedgerRow) => (
    <div className="flex flex-wrap gap-2">
      {quickApprovable(row) && (
        <button className={signalClass} disabled={busy} onClick={() => void approve([row])}>
          승인
        </button>
      )}
      <a className={secondaryClass} href={`/m/uses/${row.id}`}>
        {row.review_status === 'SUBMITTED' ? '열기' : '보기'}
      </a>
    </div>
  );
  const amounts = (row: LedgerRow) => (
    <div className="space-y-1">
      <p>입력·검토 {money(row.review_total_amount)}</p>
      <p className="font-bold">승인 {money(row.total_amount)}</p>
    </div>
  );
  return (
    <div className="min-w-0">
      <Heading
        title="운행 결재"
        description="운송일자별로 확인하고 승인하세요. 반려는 보완 요청된 운행입니다."
      >
        <a className={secondaryClass} href={`/api/approvals/export.xlsx?${search}`}>
          엑셀로 받기
        </a>
      </Heading>
      <ApprovalTabs
        status={query.review_status}
        counts={data?.counts}
        onChange={(value) => change({ review_status: value })}
      />
      <details className={`${panelClass} mb-4 lg:hidden`}>
        <summary className="min-h-11 cursor-pointer font-bold">
          필터 · {query.from} ~ {query.to}
        </summary>
        <div className="grid gap-4">
          {filters.map(([key, title]) => (
            <div key={key}>
              <p className="mb-2 font-semibold">{title}</p>
              {filter(key)}
            </div>
          ))}
        </div>
      </details>
      <Notice error={error || failures} success={message} onRetry={error ? refresh : undefined} />
      {data && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p role="status">
            {query.from === query.to ? '하루' : '기간'} 합계{' '}
            <strong>
              {data.summary.count}건 · {money(data.summary.amount)}
            </strong>
            <span className="block text-sm text-slate-600">
              검색 전체 · 취소 제외 · 공급가 · 미확정 비용 {data.summary.unknown_count}개
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              className={secondaryClass}
              disabled={busy || !quickRows.length}
              onClick={() =>
                setSelection({
                  search,
                  ids: chosen.length === quickRows.length ? [] : quickRows.map((r) => r.id),
                })
              }
            >
              {chosen.length > 0 && chosen.length === quickRows.length ? '선택 해제' : '승인 가능 모두 선택'}
            </button>
            <button
              className={signalClass}
              disabled={busy || !chosen.length}
              onClick={() => void approve(chosen)}
            >
              선택 승인 ({chosen.length})
            </button>
          </div>
        </div>
      )}
      <div
        className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white lg:block"
        aria-label="운행 결재 표"
      >
        <table className="w-full min-w-[90rem] text-left text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="p-3">선택</th>
              {filters.slice(0, 5).map(([key, title]) => (
                <th key={key} className="w-48 p-3 align-top">
                  <p className="mb-2">{title}</p>
                  {filter(key)}
                </th>
              ))}
              <th className="p-3">금액 (공급가)</th>
              <th className="w-40 p-3 align-top">
                <p className="mb-2">진행상태</p>
                {filter('status')}
              </th>
              <th className="p-3">결재</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className={`border-t border-slate-200 ${row.operation_status === 'CANCELED' ? 'opacity-50' : ''}`}
              >
                <td className="p-3">{select(row)}</td>
                <td className="p-3">
                  {row.use_date}
                  <span className="block text-xs text-slate-500">{row.use_no}</span>
                </td>
                <td className="p-3 break-words">
                  {row.route_summary}
                  <p>{row.cargo_desc}</p>
                </td>
                <td className="p-3">{row.project_name}</td>
                <td className="p-3">{row.driver_name}</td>
                <td className="p-3">{row.reviewer_name ?? '미지정'}</td>
                <td className="p-3">{amounts(row)}</td>
                <td className="p-3">{status(row)}</td>
                <td className="p-3">{action(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 lg:hidden" aria-label="운행 결재 카드 목록">
        {rows.map((row) => (
          <article
            key={row.id}
            className={`${panelClass} break-words ${row.operation_status === 'CANCELED' ? 'opacity-50' : ''}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>
                {row.use_date} · {status(row)}
              </strong>
              {select(row)}
            </div>
            <h2 className="mt-2 text-lg font-bold">{row.project_name}</h2>
            <p>{row.route_summary}</p>
            <p>{row.cargo_desc}</p>
            <p className="my-2">
              기사 {row.driver_name} · 담당자 {row.reviewer_name ?? '미지정'}
            </p>
            {amounts(row)}
            <div className="mt-3">{action(row)}</div>
          </article>
        ))}
      </div>
      {(loading || data?.total === 0) && (
        <Empty loading={loading}>해당하는 운행이 없습니다. 날짜나 필터를 바꿔 보세요.</Empty>
      )}
      {data && (
        <Pager
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          onChange={(page) => change({ page: String(page) })}
        />
      )}
    </div>
  );
}
