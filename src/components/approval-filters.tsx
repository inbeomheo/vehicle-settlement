'use client';
import { usePathname, useSearchParams } from 'next/navigation';
import { todaySeoul } from '@/client/types';
import { approvalLabels, approvalStatuses, shiftDay } from '@/shared/approvals';
import { button as driverButton, control as driverControl } from './use-form/fields';
import { inputClass, secondaryClass } from './manager/common';

export function useApprovalQuery() {
  const params = useSearchParams();
  const pathname = usePathname();
  const query = Object.fromEntries(params.entries());
  query.from ||= todaySeoul();
  query.to ||= query.from;
  const search = new URLSearchParams(query).toString();
  function change(patch: Record<string, string>) {
    const next = new URLSearchParams({ ...query, page: '1', ...patch });
    for (const [key, value] of [...next]) if (!value) next.delete(key);
    window.history.pushState(null, '', `${pathname}?${next}`);
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
          className={`${driver ? driverButton : secondaryClass} flex-wrap whitespace-normal ${(status || 'ALL') === value ? 'border-blue-700 bg-blue-50 text-blue-900' : ''}`}
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
  from: string;
  to: string;
  onChange: (patch: Record<string, string>) => void;
}) {
  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          aria-label="이전 날"
          className={driver ? driverButton : secondaryClass}
          onClick={() => {
            const day = shiftDay(from, -1);
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
            const day = shiftDay(from, 1);
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
          value={from}
          onChange={(e) => {
            if (e.target.value)
              onChange({ from: e.target.value, to: e.target.value > to ? e.target.value : to });
          }}
        />
      </label>
      <label className="grid min-w-0 gap-1 text-sm font-normal">
        종료일
        <input
          aria-label="운송 종료일"
          className={driver ? driverControl : inputClass}
          type="date"
          value={to}
          min={from}
          onChange={(e) => {
            if (e.target.value) onChange({ to: e.target.value });
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
