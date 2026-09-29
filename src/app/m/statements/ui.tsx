'use client';
import { cloneElement, useCallback, useEffect, useId, useState, type ReactElement } from 'react';
import type { getStatement, listStatements, statementCandidates } from '@/server/services/statements';
export type StatementDetail = Awaited<ReturnType<typeof getStatement>>;
export type StatementList = Awaited<ReturnType<typeof listStatements>>;
export type Candidate = Awaited<ReturnType<typeof statementCandidates>>['rows'][number];
export const money = (n: number | null | undefined) =>
  n == null ? '미확정' : `${n.toLocaleString('ko-KR')}원`;
export const dateTime = (value: string | Date | null) =>
  value
    ? new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Seoul',
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(value))
    : '-';
export const buttonClass =
  'inline-flex min-h-11 items-center justify-center rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800 disabled:cursor-wait disabled:opacity-50';
export const secondaryClass =
  'inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50';
export const inputClass =
  'mt-1 block min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2';
export const panelClass = 'rounded-xl border border-slate-200 bg-white p-4 sm:p-6';
export const statusLabels = { DRAFT: '작성 중', CONFIRMED: '확정', CANCELED: '취소' };
export const billingLabels: Record<string, string> = {
  PER_TRIP: '회당',
  PER_DAY: '일대',
  HALF_DAY: '반일',
  MONTHLY: '월대',
  PER_HOUR: '시간',
  PER_TON: '톤',
  PER_M3: '루베',
  LUMP_SUM: '1식',
};
const retryKeys = new Map<string, string>();
export async function api<T>(url: string, body?: unknown, method = 'POST'): Promise<T> {
  const signature = `${method}:${url}:${JSON.stringify(body)}`;
  const key = retryKeys.get(signature) ?? crypto.randomUUID();
  if (body !== undefined) retryKeys.set(signature, key);
  const response = await fetch(
    url,
    body === undefined
      ? { cache: 'no-store' }
      : {
          method,
          headers: { 'content-type': 'application/json', 'idempotency-key': key },
          body: JSON.stringify(body),
        },
  );
  const result = await response.json();
  retryKeys.delete(signature);
  if (!response.ok) {
    const details = Array.isArray(result.error?.details)
      ? result.error.details
          .map((d: { useNo?: string; reason?: string; message?: string; path?: string[] }) =>
            [d.useNo, d.reason ?? d.message].filter(Boolean).join(' · '),
          )
          .join('\n')
      : '';
    throw new Error(
      [result.error?.message ?? '요청을 처리하지 못했습니다.', details].filter(Boolean).join('\n'),
    );
  }
  return result.data as T;
}
export function useResource<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setData(null);
    api<T>(url)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [url, revision]);
  return { data, error, loading, reload };
}
export function ErrorMessage({ error }: { error: string }) {
  return error ? (
    <p
      role="alert"
      className="whitespace-pre-line rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
    >
      {error}
    </p>
  ) : null;
}
export function Field({ label, children }: { label: string; children: ReactElement<{ id?: string }> }) {
  const id = useId();
  return (
    <div className="min-w-0 text-sm font-medium text-slate-700">
      <label htmlFor={id} className="block">
        {label}
      </label>
      {cloneElement(children, { id })}
    </div>
  );
}
export function Totals({
  supply_total,
  tax_total,
  grand_total,
}: {
  supply_total: number;
  tax_total: number;
  grand_total: number;
}) {
  return (
    <dl className="grid grid-cols-1 gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-3">
      {[
        ['공급가', supply_total],
        ['세액', tax_total],
        ['총액', grand_total],
      ].map(([name, value]) => (
        <div key={name}>
          <dt className="text-sm text-slate-600">{name}</dt>
          <dd className="mt-1 text-xl font-bold tabular-nums">{money(Number(value))}</dd>
        </div>
      ))}
    </dl>
  );
}
export function DraftWarnings({
  blocked_count,
  unpriced_count,
}: {
  blocked_count: number;
  unpriced_count: number;
}) {
  return blocked_count > 0 ? (
    <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
      확정 불가 {blocked_count}건 (금액 미확정 {unpriced_count}건) · 합계에서 제외했습니다. 해당 항목을
      보류·제외하거나 검수를 완료하세요.
    </p>
  ) : null;
}
export function DirectionTabs({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: 'PAYABLE' | 'RECEIVABLE') => void;
}) {
  return (
    <div role="tablist" aria-label="명세 방향" className="inline-flex rounded-xl bg-slate-200 p-1">
      {(['PAYABLE', 'RECEIVABLE'] as const).map((direction) => (
        <button
          key={direction}
          type="button"
          role="tab"
          aria-selected={value === direction}
          className={`min-h-11 rounded-lg px-5 font-semibold ${value === direction ? 'bg-white text-blue-800 shadow-sm' : 'text-slate-600'}`}
          onClick={() => onChange(direction)}
        >
          {direction === 'PAYABLE' ? '지급' : '청구'}
        </button>
      ))}
    </div>
  );
}
export function monthPeriod(offset = 0) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [year, month] = today.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1 + offset, 1));
  const end = new Date(Date.UTC(year, month + offset, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}
export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (v: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <span>
        총 {total}건 · {page}페이지
      </span>
      <div className="flex gap-2">
        <button className={secondaryClass} disabled={page <= 1} onClick={() => onPage(page - 1)}>
          이전
        </button>
        <button
          className={secondaryClass}
          disabled={page * pageSize >= total}
          onClick={() => onPage(page + 1)}
        >
          다음
        </button>
      </div>
    </div>
  );
}
