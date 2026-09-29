'use client';
import { useState, type FormEvent } from 'react';
import {
  api,
  billingLabels,
  buttonClass,
  ErrorMessage,
  Field,
  inputClass,
  money,
  monthPeriod,
  panelClass,
  secondaryClass,
  Totals,
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
  const [rows, setRows] = useState<Candidate[] | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [clientId] = useState(() => crypto.randomUUID());
  const lookups = useResource<Lookup>('/api/lookups');
  async function find(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api<{ rows: Candidate[] }>(
        `/api/statements/candidates?${new URLSearchParams({ direction, counterpartyId: party, periodStart: start, periodEnd: end })}`,
      );
      setRows(result.rows);
      setChoices(
        Object.fromEntries(
          result.rows.map((row) => [
            row.charge_line_id,
            { inclusion: row.eligible ? 'INCLUDED' : 'EXCLUDED', hold_reason: '' },
          ]),
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
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
      setBusy(false);
    }
  }
  const included = rows?.filter((row) => choices[row.charge_line_id]?.inclusion === 'INCLUDED') ?? [];
  const supply = included.reduce((sum, row) => sum + (row.snapshot.supply_amount ?? 0), 0);
  const tax = included.reduce((sum, row) => sum + (row.snapshot.tax_amount ?? 0), 0);
  function reset() {
    setRows(null);
  }
  return (
    <section className={`${panelClass} space-y-5`}>
      <h2 className="text-xl font-bold">{replaces ? '취소 명세 재작성' : '새 정산'}</h2>
      <form onSubmit={find} className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {[-1, 0].map((offset) => (
            <button
              type="button"
              key={offset}
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
              disabled={!!replaces}
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
        <ErrorMessage error={lookups.error} />
        <button className={secondaryClass} disabled={busy || lookups.loading}>
          {busy ? '조회 중…' : '후보 조회'}
        </button>
      </form>
      <ErrorMessage error={error} />
      {rows && (
        <form onSubmit={save} className="space-y-4">
          <p className="text-sm text-slate-600">
            종료일까지의 미정산 과거분을 함께 표시합니다. 보류 항목은 이번 합계에서 제외되며 다음 정산 후보로
            남습니다.
          </p>
          {!rows.length ? (
            <p className="rounded-lg bg-slate-50 p-6">조회된 미정산 비용이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="border-y bg-slate-50">
                  <tr>
                    {[
                      '포함 여부',
                      '사용일 / 사용번호',
                      '현장 / 차량 / 기사',
                      '과금 / 운행수',
                      '공급가 / 세액',
                      '상태·사유',
                    ].map((h) => (
                      <th className="p-3" key={h}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr className="border-b align-top" key={row.charge_line_id}>
                      <td className="p-3">
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
                      <td className="p-3">
                        <p>{row.snapshot.use_date}</p>
                        <p>{row.snapshot.use_no}</p>
                        {row.snapshot.carried_forward && (
                          <span className="rounded bg-amber-100 px-2 text-amber-900">전월분</span>
                        )}
                      </td>
                      <td className="p-3">
                        {row.snapshot.project_name}
                        <br />
                        {row.snapshot.plate_no} · {row.snapshot.driver_name}
                      </td>
                      <td className="p-3">
                        {billingLabels[row.snapshot.billing_unit]} · 수량 {row.snapshot.quantity ?? '미정'}
                        <br />
                        운행 {row.snapshot.trip_count}건
                      </td>
                      <td className="p-3 tabular-nums">
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
