'use client';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useBusy } from '@/components/ui/use-busy';
import { chargeTypeLabel, chargeUnitLabel } from '@/components/manager/charge-display';
import { formatQuantity } from '@/shared/quantity';
import {
  api,
  buttonClass,
  ErrorMessage,
  Field,
  focusField,
  inputClass,
  money,
  monthPeriod,
  panelClass,
  secondaryClass,
  Totals,
  DraftWarnings,
  useResource,
  type Candidate,
  type StatementDetail,
} from './ui';
type Choice = { inclusion: 'INCLUDED' | 'HELD' | 'EXCLUDED'; hold_reason: string };
type Lookup = { counterparties: { id: string; name: string; kind: string }[] };
export function NewStatement({
  direction,
  replaces,
  onCreated,
}: {
  direction: 'PAYABLE' | 'RECEIVABLE';
  replaces?: StatementDetail;
  onCreated: (id: string) => void;
}) {
  const initial = monthPeriod(-1);
  const [party, setParty] = useState(replaces?.counterparty_id ?? '');
  const [start, setStart] = useState(replaces?.period_start ?? initial.start);
  const [end, setEnd] = useState(replaces?.period_end ?? initial.end);
  // 자동완성·날짜 선택기에 따라 onChange가 빠질 수 있어 저장 시점의 입력칸 값을 읽는다.
  const dueRef = useRef<HTMLInputElement>(null);
  const [unsubmittedCount, setUnsubmittedCount] = useState(0);
  const [showDrafts, setShowDrafts] = useState(false);
  const [rows, setRows] = useState<Candidate[] | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const { busy: saving, begin, end: finish } = useBusy();
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);
  const busy = saving || loading;
  useEffect(
    () => () => {
      requestId.current += 1;
    },
    [],
  );
  const [error, setError] = useState('');
  const [missingHold, setMissingHold] = useState<Set<string>>(new Set());
  const holdIdPrefix = useId();
  const [clientId] = useState(() => crypto.randomUUID());
  const lookups = useResource<Lookup>('/api/lookups');
  async function findCandidates(includeDrafts = false, preserve = false) {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const result = await api<{ rows: Candidate[]; unsubmitted_count: number }>(
        `/api/statements/candidates?${new URLSearchParams({ direction, counterpartyId: party, periodStart: start, periodEnd: end, includeDrafts: String(includeDrafts) })}`,
      );
      if (currentRequest !== requestId.current) return;
      setRows(result.rows);
      setUnsubmittedCount(result.unsubmitted_count);
      setShowDrafts(includeDrafts);
      setChoices((previous) =>
        Object.fromEntries(
          result.rows.map((row) => [
            row.charge_line_id,
            preserve && previous[row.charge_line_id]
              ? previous[row.charge_line_id]
              : { inclusion: !preserve && row.eligible ? 'INCLUDED' : 'EXCLUDED', hold_reason: '' },
          ]),
        ),
      );
    } catch (e) {
      if (currentRequest === requestId.current) {
        setRows(null);
        setError((e as Error).message);
      }
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (loading || !rows) return;
    const missing = rows
      .map((row) => row.charge_line_id)
      .filter((id) => choices[id]?.inclusion === 'HELD' && !choices[id].hold_reason.trim());
    setMissingHold(new Set(missing));
    if (missing.length) {
      focusField(`${holdIdPrefix}${missing[0]}`);
      return;
    }
    if (!begin()) return;
    setError('');
    try {
      const items = Object.entries(choices)
        .filter(([, c]) => c.inclusion !== 'EXCLUDED')
        .map(([id, c]) => ({
          charge_line_id: id,
          inclusion: c.inclusion,
          ...(c.inclusion === 'HELD' ? { hold_reason: c.hold_reason.trim() } : {}),
        }));
      if (!items.some((i) => i.inclusion === 'INCLUDED'))
        throw new Error('포함할 비용을 한 건 이상 선택하세요.');
      const result = await api<StatementDetail>('/api/statements', {
        direction,
        counterparty_id: party,
        period_start: start,
        period_end: end,
        due_date: dueRef.current?.value || null,
        client_request_id: clientId,
        items,
        ...(replaces ? { replaces_statement_id: replaces.id } : {}),
      });
      onCreated(result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      finish();
    }
  }
  const included =
    rows?.filter(
      (row) =>
        row.eligible &&
        row.snapshot.supply_amount !== null &&
        row.snapshot.tax_amount !== null &&
        choices[row.charge_line_id]?.inclusion === 'INCLUDED',
    ) ?? [];
  const supply = included.reduce((sum, row) => sum + (row.snapshot.supply_amount ?? 0), 0);
  const tax = included.reduce((sum, row) => sum + (row.snapshot.tax_amount ?? 0), 0);
  function reset() {
    requestId.current += 1;
    setLoading(false);
    setError('');
    setUnsubmittedCount(0);
    setShowDrafts(false);
    setChoices({});
    setMissingHold(new Set());
    setRows(null);
  }
  function choose(id: string, change: Partial<Choice>) {
    setChoices((previous) => ({ ...previous, [id]: { ...previous[id], ...change } }));
    if (missingHold.has(id)) {
      const next = new Set(missingHold);
      next.delete(id);
      setMissingHold(next);
    }
  }
  return (
    <section className={`${panelClass} space-y-5`}>
      <h2 className="text-xl font-bold">{replaces ? '취소 명세 재작성' : '새 정산'}</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void findCandidates();
        }}
        className="space-y-4"
      >
        <div className="flex flex-wrap gap-2">
          {[-1, 0].map((offset) => (
            <button
              type="button"
              key={offset}
              disabled={saving}
              className={secondaryClass}
              onClick={() => {
                const p = monthPeriod(offset);
                setStart(p.start);
                setEnd(p.end);
                reset();
              }}
            >
              {offset === -1 ? '전월' : '당월'}
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="거래처">
            <select
              className={inputClass}
              required
              value={party}
              disabled={!!replaces || saving}
              onChange={(e) => {
                setParty(e.target.value);
                reset();
              }}
            >
              <option value="">거래처 선택</option>
              {lookups.data?.counterparties
                .filter((p) => (p.kind === 'CUSTOMER') === (direction === 'RECEIVABLE'))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="기간 시작">
            <input
              className={inputClass}
              type="date"
              disabled={saving}
              required
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                reset();
              }}
            />
          </Field>
          <Field label="기간 종료">
            <input
              className={inputClass}
              type="date"
              disabled={saving}
              required
              min={start}
              value={end}
              onChange={(e) => {
                setEnd(e.target.value);
                reset();
              }}
            />
          </Field>
          <Field label={direction === 'PAYABLE' ? '지급 예정일' : '입금 예정일'}>
            <input ref={dueRef} className={inputClass} type="date" name="due_date" defaultValue="" />
          </Field>
        </div>
        <ErrorMessage error={lookups.error} onRetry={lookups.reload} />
        <button className={secondaryClass} disabled={busy || lookups.loading}>
          {busy ? '조회 중…' : '후보 조회'}
        </button>
      </form>
      <ErrorMessage
        error={error}
        onRetry={!saving && rows === null && party ? () => void findCandidates(showDrafts, true) : undefined}
      />
      {rows && (
        <form onSubmit={save} noValidate className="space-y-4">
          <p className="text-sm text-slate-600">
            종료일까지의 미정산 과거분을 함께 표시합니다. 보류 항목은 이번 합계에서 제외되며 다음 정산 후보로
            남습니다.
          </p>
          {unsubmittedCount > 0 && (
            <button
              type="button"
              className={secondaryClass}
              disabled={busy}
              aria-expanded={showDrafts}
              onClick={() => void findCandidates(!showDrafts, true)}
            >
              {showDrafts ? '미제출 숨기기' : `미제출 ${unsubmittedCount}건 보기`}
            </button>
          )}
          {!rows.length ? (
            <p className="rounded-lg bg-slate-50 p-6">조회된 미정산 비용이 없습니다.</p>
          ) : (
            <div className="md:overflow-x-auto">
              <table className="block w-full text-left text-sm md:table md:min-w-[1040px]">
                <thead className="hidden border-y bg-slate-50 md:table-header-group">
                  <tr>
                    {[
                      '포함 여부',
                      '사용일 / 사용번호',
                      '현장 / 차량 / 기사',
                      '비용 종류',
                      '과금 / 운행수',
                      '공급가 / 세액',
                      '상태·사유',
                    ].map((h, index) => (
                      <th
                        className={`p-3 whitespace-nowrap ${index === 0 ? 'w-60' : ''} ${index === 5 ? 'text-right' : ''}`}
                        key={h}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="grid gap-4 md:table-row-group">
                  {rows.map((row) => {
                    const choice = choices[row.charge_line_id];
                    const holdId = `${holdIdPrefix}${row.charge_line_id}`;
                    const holdMissing = missingHold.has(row.charge_line_id);
                    return (
                      <tr
                        className="grid grid-cols-2 rounded-lg border p-2 align-top md:table-row md:rounded-none md:border-0 md:border-b md:p-0"
                        key={row.charge_line_id}
                      >
                        <td className="col-span-2 min-w-0 p-3 align-top md:w-60">
                          <select
                            aria-label={`${row.snapshot.use_no} 포함 여부`}
                            className={inputClass}
                            value={choice?.inclusion}
                            onChange={(e) =>
                              choose(row.charge_line_id, { inclusion: e.target.value as Choice['inclusion'] })
                            }
                          >
                            <option value="INCLUDED" disabled={!row.eligible}>
                              포함
                            </option>
                            <option value="HELD">보류</option>
                            <option value="EXCLUDED">제외</option>
                          </select>
                          {choice?.inclusion === 'HELD' && (
                            <>
                              <textarea
                                id={holdId}
                                aria-label={`${row.snapshot.use_no} 보류 사유`}
                                aria-invalid={holdMissing || undefined}
                                aria-describedby={holdMissing ? `${holdId}-error` : undefined}
                                className={`${inputClass} resize-y ${holdMissing ? 'border-red-600 ring-3 ring-red-100' : ''}`}
                                placeholder="보류 사유"
                                rows={2}
                                required
                                maxLength={1000}
                                value={choice.hold_reason}
                                onChange={(e) => choose(row.charge_line_id, { hold_reason: e.target.value })}
                              />
                              {holdMissing && (
                                <p id={`${holdId}-error`} className="mt-1 font-semibold text-red-700">
                                  보류 사유를 입력해 주세요.
                                </p>
                              )}
                            </>
                          )}
                        </td>
                        <td className="min-w-0 p-3 align-top">
                          <p className="num whitespace-nowrap">{row.snapshot.use_date}</p>
                          <p className="num whitespace-nowrap">{row.snapshot.use_no}</p>
                          {row.snapshot.carried_forward && (
                            <span className="rounded bg-amber-100 px-2 whitespace-nowrap text-amber-900">
                              전월분
                            </span>
                          )}
                        </td>
                        <td className="min-w-0 p-3 align-top">
                          <p className="break-keep">{row.snapshot.project_name}</p>
                          <p className="md:whitespace-nowrap">
                            {row.snapshot.plate_no} · {row.snapshot.driver_name}
                          </p>
                        </td>
                        <td className="min-w-0 p-3 align-top">
                          <span className="block text-xs text-slate-600 md:hidden">비용 종류</span>
                          <span className="whitespace-nowrap">
                            {chargeTypeLabel(row.snapshot.charge_type)}
                          </span>
                        </td>
                        <td className="min-w-0 p-3 align-top">
                          <p className="whitespace-nowrap">
                            {chargeUnitLabel(row.snapshot.charge_type, row.snapshot.billing_unit)} · 수량{' '}
                            {row.snapshot.quantity == null ? '미정' : formatQuantity(row.snapshot.quantity)}
                          </p>
                          <p className="whitespace-nowrap">운행 {row.snapshot.trip_count}건</p>
                        </td>
                        <td className="p-3 align-top tabular-nums md:text-right">
                          <span className="block text-xs text-slate-600 md:hidden">공급가 / 세액</span>
                          <p className="whitespace-nowrap">{money(row.snapshot.supply_amount)}</p>
                          <p className="whitespace-nowrap text-slate-600">{money(row.snapshot.tax_amount)}</p>
                        </td>
                        <td
                          className={`col-span-2 min-w-0 p-3 align-top break-keep ${row.eligible ? 'text-emerald-700' : 'text-amber-800'}`}
                        >
                          {row.eligible ? '포함 가능' : row.reasons.join(' · ')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!!rows.length && (
            <>
              <DraftWarnings
                blocked_count={rows.filter((row) => !row.eligible).length}
                unpriced_count={
                  rows.filter(
                    (row) => row.snapshot.supply_amount === null || row.snapshot.tax_amount === null,
                  ).length
                }
              />
              <Totals supply_total={supply} tax_total={tax} grand_total={supply + tax} />
              {missingHold.size > 0 && (
                <p
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800"
                >
                  보류 사유를 입력해 주세요. ({missingHold.size}건)
                </p>
              )}
              <button className={buttonClass} disabled={busy}>
                {busy ? '저장 중…' : '초안 만들기'}
              </button>
            </>
          )}
        </form>
      )}
    </section>
  );
}
