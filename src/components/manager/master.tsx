'use client';
import { useState } from 'react';
import Link from 'next/link';
import { masterConfigs, type MasterField } from './master-config';
import {
  Badge,
  Empty,
  Field,
  Heading,
  Notice,
  buttonClass,
  inputClass,
  label,
  money,
  mutate,
  panelClass,
  secondaryClass,
  useRemote,
} from './common';
type Row = Record<string, string | number | boolean | null> & { id: string };
const periodKeys = [
  'name',
  'valid_from',
  'valid_to',
  'unit_price',
  'tax_mode',
  'rounding',
  'min_charge',
  'notes',
];
export function MasterIndex() {
  return (
    <>
      <Heading title="기준정보" description="사용 당시 정보와 계약 금액은 과거 기록에 보존됩니다." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(masterConfigs).map(([key, config]) => (
          <Link className={`${panelClass} hover:border-blue-400`} href={`/m/master/${key}`} key={key}>
            <h2 className="text-lg font-bold">{config.title}</h2>
            <p className="mt-2 text-sm text-slate-500">조회 및 관리 →</p>
          </Link>
        ))}
      </div>
    </>
  );
}
export function Master({ resource }: { resource: string }) {
  const config = masterConfigs[resource];
  const me = useRemote<{ role: string }>('/api/me');
  const rows = useRemote<Row[]>(config ? `/api/admin/${resource}` : null);
  const lookups = useRemote<Record<string, Row[]>>('/api/lookups');
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  if (!config) return <Heading title="기준정보를 찾을 수 없습니다." />;
  const admin = me.data?.role === 'ADMIN';
  const begin = (row: Row | null, newPeriod = false) => {
    setEditing(row);
    setPeriod(newPeriod);
    setError('');
    setSuccess('');
    setOpen(true);
    setForm(
      Object.fromEntries(
        config.fields.map((field) => [
          field.key,
          newPeriod && ['valid_from', 'valid_to'].includes(field.key)
            ? ''
            : row?.[field.key] != null
              ? field.type === 'boolean'
                ? Boolean(row[field.key])
                : String(row[field.key])
              : field.type === 'boolean'
                ? true
                : (field.options?.[0] ?? ''),
        ]),
      ),
    );
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const input: Record<string, unknown> = {};
      for (const field of config.fields.filter((field) => !period || periodKeys.includes(field.key))) {
        const value = form[field.key];
        input[field.key] =
          field.type === 'boolean'
            ? Boolean(value)
            : value === '' || value === undefined
              ? null
              : field.type === 'number' && field.key !== 'tonnage'
                ? Number(value)
                : value;
      }
      if (resource === 'rates' && editing) input.version = editing.version;
      await mutate(
        `/api/admin/${resource}${editing ? '/' + editing.id : ''}${period ? '/periods' : ''}`,
        editing && !period ? 'PATCH' : 'POST',
        input,
      );
      setOpen(false);
      rows.refresh();
      lookups.refresh();
      setSuccess(
        period ? '새 적용기간을 추가했습니다. 기존 적용기간은 필요한 경우 자동 종료됩니다.' : '저장했습니다.',
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };
  const optionName = (source: string, value: unknown) =>
    lookups.data?.[source]?.find((row) => row.id === value)?.name ??
    lookups.data?.[source]?.find((row) => row.id === value)?.plate_no ??
    value;
  const filtered = (rows.data ?? []).filter((row) =>
    Object.values(row).some((value) => String(value ?? '').includes(search)),
  );
  const fieldValue = (row: Row, field: MasterField) => {
    if (field.type === 'boolean') return <Badge value={row[field.key] ? 'ACTIVE' : 'DISABLED'} />;
    if (field.source) return String(optionName(field.source, row[field.key]) ?? '—');
    if (field.key === 'min_charge' && row[field.key] == null) return '없음';
    if (['unit_price', 'min_charge'].includes(field.key)) return money(row[field.key] as number | null);
    return label(String(row[field.key] ?? ''));
  };
  const rateCoreFields = [
    'direction',
    'counterparty_id',
    'billing_unit',
    'unit_price',
    'min_charge',
    'valid_from',
    'valid_to',
  ];
  const rowActions = (row: Row) =>
    admin && (
      <div className="flex flex-wrap gap-2">
        <button className={secondaryClass} onClick={() => begin(row)}>
          수정
        </button>
        {resource === 'rates' && (
          <button className={secondaryClass} onClick={() => begin(row, true)}>
            새 적용기간 추가
          </button>
        )}
      </div>
    );
  return (
    <>
      <Heading
        title={config.title}
        description={
          resource === 'rates'
            ? '참조된 계약의 가격 조건은 새 적용기간으로 추가하세요. 동일 조건의 기간 중복은 허용하지 않습니다.'
            : '사용 중지는 신규 선택만 제한하며 과거 사용 내역은 보존됩니다.'
        }
      >
        <div className="flex flex-wrap gap-2">
          <Link className={secondaryClass} href="/m/master">
            기준정보 목록
          </Link>
          {admin && (
            <button
              className={buttonClass}
              onClick={() => begin(resource === 'company' ? (rows.data?.[0] ?? null) : null)}
            >
              {resource === 'company' && rows.data?.length ? '회사 정보 수정' : '새로 등록'}
            </button>
          )}
        </div>
      </Heading>
      <Notice error={error || rows.error || lookups.error} success={success} />
      {!admin && me.data && (
        <p className="mb-4 text-sm text-slate-500">등록·수정은 관리자 권한이 필요합니다.</p>
      )}
      {open && (
        <form onSubmit={save} className={`${panelClass} mb-5`}>
          <h2 className="mb-4 text-lg font-bold">
            {period ? '새 적용기간 추가' : editing ? '정보 수정' : '새로 등록'}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {config.fields
              .filter((field) => !period || periodKeys.includes(field.key))
              .map((field) => (
                <Field key={field.key} title={field.title}>
                  {field.type === 'boolean' ? (
                    <input
                      type="checkbox"
                      className="h-6 w-6"
                      checked={Boolean(form[field.key])}
                      onChange={(e) => setForm({ ...form, [field.key]: e.target.checked })}
                    />
                  ) : field.type === 'select' ? (
                    <select
                      required={field.required}
                      className={inputClass}
                      value={String(form[field.key] ?? '')}
                      onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                    >
                      {!field.options && <option value="">선택하세요</option>}
                      {field.options?.map((value) => (
                        <option key={value} value={value}>
                          {label(value)}
                        </option>
                      ))}
                      {field.source &&
                        lookups.data?.[field.source]?.map((row) => (
                          <option key={row.id} value={row.id}>
                            {String(row.name ?? row.plate_no)}
                          </option>
                        ))}
                      {field.source &&
                        form[field.key] &&
                        !lookups.data?.[field.source]?.some((row) => row.id === form[field.key]) && (
                          <option value={String(form[field.key])}>기존 선택 (사용 중지)</option>
                        )}
                    </select>
                  ) : (
                    <input
                      className={inputClass}
                      required={field.required}
                      type={field.type ?? 'text'}
                      min={field.type === 'number' ? '0' : undefined}
                      step={field.step ?? '1'}
                      maxLength={2000}
                      value={String(form[field.key] ?? '')}
                      onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                    />
                  )}
                </Field>
              ))}
          </div>
          <div className="mt-5 flex gap-2">
            <button className={buttonClass} disabled={busy}>
              {busy ? '저장 중…' : '저장'}
            </button>
            <button type="button" className={secondaryClass} disabled={busy} onClick={() => setOpen(false)}>
              닫기
            </button>
          </div>
        </form>
      )}
      <div className="mb-4 max-w-md">
        <Field title="목록 검색">
          <input
            className={inputClass}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름·코드·기간"
          />
        </Field>
      </div>
      {resource === 'rates' && (
        <div className="grid gap-3 md:hidden" aria-label="계약·단가 카드 목록">
          {!rows.loading &&
            filtered.map((row) => (
              <article key={row.id} className={panelClass}>
                <div className="mb-3 flex items-start justify-between gap-3">
                  <h2 className="font-bold">{String(row.name)}</h2>
                  <Badge value={row.active ? 'ACTIVE' : 'DISABLED'} />
                </div>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  {config.fields
                    .filter((field) => rateCoreFields.includes(field.key))
                    .map((field) => (
                      <div key={field.key} className="min-w-0">
                        <dt className="text-slate-500">{field.title}</dt>
                        <dd className="mt-1 break-words font-medium">{fieldValue(row, field)}</dd>
                      </div>
                    ))}
                </dl>
                <details className="my-3 border-t border-slate-100">
                  <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">
                    적용 조건·세금 더 보기
                  </summary>
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    {config.fields
                      .filter(
                        (field) =>
                          !rateCoreFields.includes(field.key) && !['name', 'active'].includes(field.key),
                      )
                      .map((field) => (
                        <div key={field.key} className="min-w-0">
                          <dt className="text-slate-500">{field.title}</dt>
                          <dd className="mt-1 break-words">{fieldValue(row, field)}</dd>
                        </div>
                      ))}
                  </dl>
                </details>
                {rowActions(row)}
              </article>
            ))}
          {(rows.loading || !filtered.length) && <Empty loading={rows.loading} />}
        </div>
      )}
      <div
        className={`${resource === 'rates' ? 'hidden md:block' : ''} max-w-full overflow-x-auto rounded-xl border border-slate-200 bg-white`}
      >
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100 text-xs">
            <tr>
              {config.fields.map((field) => (
                <th key={field.key} className="whitespace-nowrap px-4 py-3">
                  {field.title}
                </th>
              ))}
              {admin && <th className="px-4 py-3">관리</th>}
            </tr>
          </thead>
          <tbody>
            {!rows.loading &&
              filtered.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  {config.fields.map((field) => (
                    <td className="min-w-28 px-4 py-3" key={field.key}>
                      {fieldValue(row, field)}
                    </td>
                  ))}
                  {admin && <td className="min-w-44 px-4 py-3">{rowActions(row)}</td>}
                </tr>
              ))}
          </tbody>
        </table>
        {(rows.loading || !filtered.length) && <Empty loading={rows.loading} />}
      </div>
    </>
  );
}
