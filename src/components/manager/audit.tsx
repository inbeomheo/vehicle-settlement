'use client';
import { useState } from 'react';
import {
  Empty,
  Field,
  Heading,
  Notice,
  Pager,
  buttonClass,
  dateTime,
  inputClass,
  label,
  panelClass,
  useRemote,
} from './common';
import { queryString, type Search } from './ledger';
type AuditRow = {
  id: string;
  at: string;
  user_name: string | null;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
};
type Result = { rows: AuditRow[]; total: number; page: number; pageSize: number };
export function AuditPanel({ useId }: { useId?: string }) {
  const [query, setQuery] = useState<Search>({ page: '1', ...(useId ? { use_id: useId } : {}) });
  const [draft, setDraft] = useState<Search>({});
  const { data, error, loading } = useRemote<Result>(`/api/audit?${queryString(query)}`);
  const change = (key: string, value: string) => setDraft((previous) => ({ ...previous, [key]: value }));
  return (
    <>
      {!useId && (
        <Heading
          title="변경 이력"
          description="담당자는 접근 가능한 사용 건·비용·증빙의 이력만 조회할 수 있습니다."
        />
      )}
      <form
        className={`${panelClass} mb-4 grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-5`}
        onSubmit={(e) => {
          e.preventDefault();
          setQuery({ ...draft, page: '1', ...(useId ? { use_id: useId } : {}) });
        }}
      >
        <Field title="대상 유형">
          <select
            className={inputClass}
            value={draft.entity_type ?? ''}
            onChange={(e) => change('entity_type', e.target.value)}
          >
            <option value="">전체</option>
            {[
              'vehicle_use',
              'charge_line',
              'evidence',
              'rate_agreement',
              'projects',
              'work_types',
              'counterparties',
              'drivers',
              'vehicles',
              'driver_affiliations',
              'user',
              'project_assignment',
              'invite',
              'company_settings',
            ].map((value) => (
              <option key={value} value={value}>
                {label(value)}
              </option>
            ))}
          </select>
        </Field>
        <Field title="사용자 ID">
          <input
            className={inputClass}
            placeholder="사용자 UUID"
            value={draft.user_id ?? ''}
            onChange={(e) => change('user_id', e.target.value)}
          />
        </Field>
        <Field title="시작일">
          <input
            type="date"
            className={inputClass}
            value={draft.from ?? ''}
            onChange={(e) => change('from', e.target.value)}
          />
        </Field>
        <Field title="종료일">
          <input
            type="date"
            className={inputClass}
            value={draft.to ?? ''}
            onChange={(e) => change('to', e.target.value)}
          />
        </Field>
        <button className={buttonClass}>이력 조회</button>
        {!useId && (
          <Field title="대상 ID">
            <input
              className={inputClass}
              placeholder="대상 UUID"
              value={draft.entity_id ?? ''}
              onChange={(e) => change('entity_id', e.target.value)}
            />
          </Field>
        )}
      </form>
      <Notice error={error} />
      <div className="grid gap-3">
        {!loading &&
          data?.rows.map((row) => (
            <details className={panelClass} key={row.id}>
              <summary className="cursor-pointer">
                <span className="font-semibold">{label(row.action)}</span>
                <span className="ml-3 text-sm text-slate-500">
                  {dateTime(row.at)} · {row.user_name ?? '시스템'} · {label(row.entity_type)}
                </span>
              </summary>
              <div className="mt-3 break-all text-xs text-slate-500">
                대상 {row.entity_id} · 사용자 {row.user_id}
              </div>
              {row.reason && <p className="mt-2 text-sm">사유: {row.reason}</p>}
              <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-2">
                <div className="min-w-0">
                  <h3 className="mb-2 text-sm font-bold">변경 전</h3>
                  <pre className="max-h-80 overflow-auto rounded-lg bg-slate-50 p-3 text-xs whitespace-pre-wrap break-all">
                    {JSON.stringify(row.before, null, 2) ?? '없음'}
                  </pre>
                </div>
                <div className="min-w-0">
                  <h3 className="mb-2 text-sm font-bold">변경 후</h3>
                  <pre className="max-h-80 overflow-auto rounded-lg bg-blue-50 p-3 text-xs whitespace-pre-wrap break-all">
                    {JSON.stringify(row.after, null, 2) ?? '없음'}
                  </pre>
                </div>
              </div>
            </details>
          ))}
      </div>
      {(loading || !data?.rows.length) && <Empty loading={loading}>변경 이력이 없습니다.</Empty>}
      {data && (
        <Pager
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          onChange={(page) => setQuery({ ...query, page: String(page) })}
        />
      )}
    </>
  );
}
