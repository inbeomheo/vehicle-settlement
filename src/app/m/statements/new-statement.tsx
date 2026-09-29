'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useBusy } from '@/components/ui/use-busy';
import { chargeTypeLabel, chargeUnitLabel } from '@/components/manager/charge-display';
import {
  api,
  buttonClass,
  ErrorMessage,
  Field,
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
  const [due, setDue] = useState('');
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
    if (loading || !rows || !begin()) return;
    setError('');
    try {
      const items = Object.entries(choices)
        .filter(([, c]) => c.inclusion !== 'EXCLUDED')
        .map(([id, c]) => ({
          charge_line_id: id,
          inclusion: c.inclusion,
          ...(c.inclusion === 'HELD' ? { hold_reason: c.hold_reason } : {}),
        }));
      if (!items.some((i) => i.inclusion === 'INCLUDED'))
        throw new Error('포함할 비용을 한 건 이상 선택하세요.');
      const result = await api<StatementDetail>('/api/statements', {
        direction,
        counterparty_id: party,
        period_start: start,
        period_end: end,
        due_date: due || null,
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
    setRows(null);
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
            <input className={inputClass} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
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
        <form onSubmit={save} className="space-y-4">
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
              <table className="block w-full text-left text-sm md:table md:min-w-[1000px]">
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
                    ].map((h) => (
                      <th className="min-w-0 break-words p-3" key={h}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="grid gap-4 md:table-row-group">
                  {rows.map((row) => (
                    <tr
                      className="grid grid-cols-2 rounded-lg border p-2 align-top md:table-row md:rounded-none md:border-0 md:border-b md:p-0"
                      key={row.charge_line_id}
                    >
                      <td className="min-w-0 break-words p-3">
                        <select
                          aria-label={`${row.snapshot.use_no} 포함 여부`}
                          className={inputClass}
                          value={choices[row.charge_line_id]?.inclusion}
                          onChange={(e) =>
                            setChoices({
                              ...choices,
                              [row.charge_line_id]: {
                                ...choices[row.charge_line_id],
                                inclusion: e.target.value as Choice['inclusion'],
                              },
                            })
                          }
                        >
                          <option value="INCLUDED" disabled={!row.eligible}>
                            포함
                          </option>
                          <option value="HELD">보류</option>
                          <option value="EXCLUDED">제외</option>
                        </select>
                        {choices[row.charge_line_id]?.inclusion === 'HELD' && (
                          <input
                            aria-label={`${row.snapshot.use_no} 보류 사유`}
                            className={inputClass}
                            placeholder="보류 사유"
                            required
                            maxLength={1000}
                            value={choices[row.charge_line_id].hold_reason}
                            onChange={(e) =>
                              setChoices({
                                ...choices,
                                [row.charge_line_id]: {
                                  ...choices[row.charge_line_id],
                                  hold_reason: e.target.value,
                                },
                              })
                            }
                          />
                        )}
                      </td>
                      <td className="min-w-0 break-words p-3">
                        <p>{row.snapshot.use_date}</p>
                        <p>{row.snapshot.use_no}</p>
                        {row.snapshot.carried_forward && (
                          <span className="rounded bg-amber-100 px-2 text-amber-900">전월분</span>
                        )}
                      </td>
                      <td className="min-w-0 break-words p-3">
                        {row.snapshot.project_name}
                        <br />
                        {row.snapshot.plate_no} · {row.snapshot.driver_name}
                      </td>
                      <td className="min-w-0 break-words p-3">
                        <span className="block text-xs text-slate-600 md:hidden">비용 종류</span>
                        {chargeTypeLabel(row.snapshot.charge_type)}
                      </td>
                      <td className="min-w-0 break-words p-3">
                        {chargeUnitLabel(row.snapshot.charge_type, row.snapshot.billing_unit)} · 수량{' '}
                        {row.snapshot.quantity ?? '미정'}
                        <br />
                        운행 {row.snapshot.trip_count}건
                      </td>
                      <td className="p-3 tabular-nums">
                        <span className="block text-xs text-slate-600 md:hidden">공급가 / 세액</span>
                        {money(row.snapshot.supply_amount)}
                        <br />
                        {money(row.snapshot.tax_amount)}
                      </td>
                      <td className={`p-3 ${row.eligible ? 'text-emerald-700' : 'text-amber-800'}`}>
                        {row.eligible ? '포함 가능' : row.reasons.join(' · ')}
                      </td>
                    </tr>
                  ))}
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
