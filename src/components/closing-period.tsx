'use client';
import type { ReactNode } from 'react';
import { useRemote } from '@/client/use-remote';
import {
  closingPeriod,
  closingPeriodLabel,
  type ClosingPeriod,
  type ClosingPeriodSettings,
} from '@/shared/closing-period';

/** 설정을 읽기 전 임의의 기간으로 조회하거나 입력 중인 날짜를 덮어쓰지 않는다. */
export function ClosingPeriodLoader({
  children,
}: {
  children: (settings: ClosingPeriodSettings) => ReactNode;
}) {
  const { data, error, refresh } = useRemote<ClosingPeriodSettings>('/api/closing-period');
  if (error)
    return (
      <div role="alert" className="space-y-2">
        <p>{error}</p>
        <button type="button" className="min-h-11 rounded-lg border px-4 py-2" onClick={refresh}>
          마감 기간 다시 불러오기
        </button>
      </div>
    );
  if (!data) return <p role="status">마감 기간을 불러오는 중…</p>;
  return children(data);
}
export function ClosingPeriodButtons({
  settings,
  onChange,
  disabled = false,
  driver = false,
}: {
  settings: ClosingPeriodSettings;
  onChange: (period: ClosingPeriod) => void;
  disabled?: boolean;
  driver?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-wrap gap-2" role="group" aria-label="마감 기간 빠른 선택">
      {[0, -1].map((offset) => (
        <button
          key={offset}
          type="button"
          disabled={disabled}
          className={`min-w-0 max-w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-semibold text-ink whitespace-normal break-keep [overflow-wrap:anywhere] hover:bg-slate-50 disabled:opacity-50 ${driver ? 'min-h-14 w-full' : 'min-h-11 text-sm'}`}
          onClick={() => onChange(closingPeriod(settings.today, settings.closing_start_day, offset))}
        >
          {closingPeriodLabel(settings.today, settings.closing_start_day, offset)}
        </button>
      ))}
    </div>
  );
}
