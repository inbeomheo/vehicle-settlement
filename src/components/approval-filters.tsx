'use client';
import { useSyncExternalStore } from 'react';
import { todaySeoul } from '@/client/types';
import { approvalLabels, approvalStatuses, shiftDay } from '@/shared/approvals';
import { button as driverButton, control as driverControl } from './use-form/fields';
import { inputClass, secondaryClass } from './list-controls';

// Both the Next.js screen and the standalone offline shell use this browser URL store.
const queryEvent = 'vehicle-approval-query';
function subscribeQuery(notify: () => void) {
  window.addEventListener('popstate', notify);
  window.addEventListener(queryEvent, notify);
  return () => {
    window.removeEventListener('popstate', notify);
    window.removeEventListener(queryEvent, notify);
  };
}
export function useApprovalQuery(defaultToday = true) {
  const currentSearch = useSyncExternalStore(
    subscribeQuery,
    () => location.search,
    () => '',
  );
  const query = Object.fromEntries(new URLSearchParams(currentSearch));
  if (defaultToday) {
    query.from ||= todaySeoul();
    query.to ||= query.from;
  }
  const search = new URLSearchParams(query).toString();
  function change(patch: Record<string, string>) {
    const next = new URLSearchParams({ ...query, page: '1', ...patch });
    for (const [key, value] of [...next]) if (!value) next.delete(key);
    window.history.pushState(null, '', `${location.pathname}?${next}`);
    window.dispatchEvent(new Event(queryEvent));
  }
  return { query, search, change };
}
export function ApprovalTabs({
  driver = false,
  status,
  counts,
  onChange,
}: {
  driver?: boolean;
  status?: string;
  counts?: Record<string, number>;
  onChange: (status: string) => void;
}) {
  return (
    <div role="group" aria-label="운행 진행상태" className="mb-4 flex flex-wrap gap-2">
      {approvalStatuses.map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={(status || 'ALL') === value}
          className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-4 py-2 whitespace-normal ${driver ? 'min-h-14' : 'min-h-11 text-sm'} ${(status || 'ALL') === value ? 'border-ink bg-ink font-bold text-white hover:bg-slate-700' : 'border-slate-300 bg-white font-medium text-ink hover:bg-slate-50'}`}
          onClick={() => onChange(value === 'ALL' ? '' : value)}
        >
          {approvalLabels[value]} <span className="num">{counts?.[value] ?? '…'}</span>
        </button>
      ))}
    </div>
  );
}
export function ApprovalDates({
  driver = false,
  from,
  to,
  onChange,
}: {
  driver?: boolean;
  from?: string;
  to?: string;
  onChange: (patch: Record<string, string>) => void;
}) {
  return (
    <div className="grid min-w-0 gap-2 sm:grid-cols-2">
      <div className="flex flex-wrap gap-1 sm:col-span-2">
        {driver && (
          <button type="button" className={driverButton} onClick={() => onChange({ from: '', to: '' })}>
            전체 기간
          </button>
        )}
        <button
          type="button"
          aria-label="이전 날"
          className={driver ? driverButton : secondaryClass}
          onClick={() => {
            const day = shiftDay(from || todaySeoul(), -1);
            onChange({ from: day, to: day });
          }}
        >
          ‹
        </button>
        <button
          type="button"
          className={driver ? driverButton : secondaryClass}
          onClick={() => onChange({ from: todaySeoul(), to: todaySeoul() })}
        >
          오늘
        </button>
        <button
          type="button"
          aria-label="다음 날"
          className={driver ? driverButton : secondaryClass}
          onClick={() => {
            const day = shiftDay(from || todaySeoul(), 1);
            onChange({ from: day, to: day });
          }}
        >
          ›
        </button>
      </div>
      <label className="grid min-w-0 gap-1 text-sm font-normal">
        시작일
        <input
          aria-label="운송 시작일"
          className={driver ? driverControl : inputClass}
          type="date"
          value={from || ''}
          onChange={(e) => {
            onChange({ from: e.target.value, to: to && e.target.value > to ? e.target.value : (to ?? '') });
          }}
        />
      </label>
      <label className="grid min-w-0 gap-1 text-sm font-normal">
        종료일
        <input
          aria-label="운송 종료일"
          className={driver ? driverControl : inputClass}
          type="date"
          value={to || ''}
          min={from}
          onChange={(e) => {
            onChange({ to: e.target.value });
          }}
        />
      </label>
    </div>
  );
}
export function ApprovalSelect({
  driver = false,
  title,
  value,
  options,
  onChange,
}: {
  driver?: boolean;
  title: string;
  value?: string;
  options: { id: string; name: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <select
      aria-label={title}
      className={driver ? driverControl : inputClass}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">전체</option>
      {value && !options.some((o) => o.id === value) && (
        <option value={value}>{value === 'me' ? '나' : '선택한 항목'}</option>
      )}
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}
