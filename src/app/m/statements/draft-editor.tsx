'use client';
import { useId, useState, type FormEvent } from 'react';
import { chargeTypeLabel, chargeUnitLabel } from '@/components/manager/charge-display';
import { formatQuantity } from '@/shared/quantity';
import {
  api,
  ErrorMessage,
  Field,
  focusField,
  inputClass,
  money,
  secondaryClass,
  type Candidate,
  type StatementDetail,
} from './ui';
import type { ItemSnapshot } from '@/server/services/statements';

type Choice = { inclusion: 'INCLUDED' | 'HELD' | 'EXCLUDED'; hold_reason: string };
export type DraftChanges = {
  version: number;
  due_date: string | null;
  items: { charge_line_id: string; inclusion: 'INCLUDED' | 'HELD'; hold_reason: string | null }[];
};
export function DraftEditor({
  statement,
  busy,
  onSave,
}: {
  statement: StatementDetail;
  busy: boolean;
  onSave: (changes: DraftChanges) => Promise<boolean>;
}) {
  const [unsubmittedCount, setUnsubmittedCount] = useState(0);
  const [showDrafts, setShowDrafts] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(
      statement.items.map((item) => [
        item.charge_line_id,
        {
          inclusion: item.inclusion,
          hold_reason: item.hold_reason ?? '',
        },
      ]),
    ),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [missingHold, setMissingHold] = useState<Set<string>>(new Set());
  const holdIdPrefix = useId();
  const existingRows: Candidate[] = statement.items.map((item) => ({
    charge_line_id: item.charge_line_id,
    estimated_supply: item.supply_amount,
    snapshot: item.snapshot as ItemSnapshot,
    eligible: item.eligible !== false,
    reasons: item.reasons ?? [],
  }));
  const existingIds = new Set(existingRows.map((row) => row.charge_line_id));
  const candidateById = new Map(candidates?.map((row) => [row.charge_line_id, row]));
  const additionalRows = candidates?.filter((candidate) => !existingIds.has(candidate.charge_line_id)) ?? [];
  const rows = [
    ...existingRows.map((row) => candidateById.get(row.charge_line_id) ?? row),
    ...additionalRows,
  ];

  async function findCandidates(includeDrafts = false) {
    setLoading(true);
    setError('');
    try {
      const result = await api<{ rows: Candidate[]; unsubmitted_count: number }>(
        `/api/statements/candidates?${new URLSearchParams({
          includeDrafts: String(includeDrafts),
          statementId: statement.id,
          direction: statement.direction,
          counterpartyId: statement.counterparty_id,
          periodStart: statement.period_start,
          periodEnd: statement.period_end,
        })}`,
      );
      setCandidates(result.rows);
      setUnsubmittedCount(result.unsubmitted_count);
      setShowDrafts(includeDrafts);
      setChoices((previous) => ({
        ...Object.fromEntries(
          result.rows.map((row) => [row.charge_line_id, { inclusion: 'EXCLUDED' as const, hold_reason: '' }]),
        ),
        ...previous,
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const missing = rows
      .map((row) => row.charge_line_id)
      .filter((id) => choices[id]?.inclusion === 'HELD' && !choices[id].hold_reason.trim());
    setMissingHold(new Set(missing));
    if (missing.length) {
      focusField(`${holdIdPrefix}${missing[0]}`);
      return;
    }
    const items: DraftChanges['items'] = [];
    for (const row of rows) {
      const choice = choices[row.charge_line_id];
      if (!choice || choice.inclusion === 'EXCLUDED') continue;
      items.push({
        charge_line_id: row.charge_line_id,
        inclusion: choice.inclusion,
        hold_reason: choice.inclusion === 'HELD' ? choice.hold_reason.trim() : null,
      });
    }
    if (!items.length) {
      setError('명세에 남길 항목을 한 건 이상 선택하세요. 전체 폐기는 명세 취소를 이용하세요.');
      return;
    }
    setError('');
    const due = new FormData(event.currentTarget).get('due_date');
    await onSave({ version: statement.version, due_date: due ? String(due) : null, items });
  }
  function choose(id: string, change: Partial<Choice>) {
    setChoices((previous) => ({
      ...previous,
      [id]: { ...(previous[id] ?? { inclusion: 'EXCLUDED', hold_reason: '' }), ...change },
    }));
    if (missingHold.has(id)) {
      const next = new Set(missingHold);
      next.delete(id);
      setMissingHold(next);
    }
  }
  return (
    <form onSubmit={save} noValidate className="space-y-4">
      <div className="max-w-xs">
        <Field label={statement.direction === 'PAYABLE' ? '지급 예정일' : '입금 예정일'}>
          <input className={inputClass} name="due_date" type="date" defaultValue={statement.due_date ?? ''} />
        </Field>
      </div>
      <div className="space-y-2">
        <button
          type="button"
          className={secondaryClass}
          disabled={busy || loading}
          onClick={() => void findCandidates()}
        >
          {loading ? '후보 조회 중…' : '추가 후보 조회'}
        </button>
        <p className="text-sm text-slate-600">
          후보를 포함하거나 기존 항목을 제외한 뒤 초안 변경을 저장하세요.
        </p>
        {unsubmittedCount > 0 && (
          <button
            type="button"
            className={secondaryClass}
            disabled={busy || loading}
            aria-expanded={showDrafts}
            onClick={() => void findCandidates(!showDrafts)}
          >
            {showDrafts ? '미제출 숨기기' : `미제출 ${unsubmittedCount}건 보기`}
          </button>
        )}
        {candidates && !additionalRows.length && (
          <p className="text-sm text-slate-600">추가할 미정산 후보가 없습니다.</p>
        )}
      </div>
      <ErrorMessage
        error={error}
        onRetry={!busy && !loading ? () => void findCandidates(showDrafts) : undefined}
      />
      {rows.map((row) => {
        const choice = choices[row.charge_line_id] ?? { inclusion: 'EXCLUDED', hold_reason: '' };
        const holdId = `${holdIdPrefix}${row.charge_line_id}`;
        const holdMissing = missingHold.has(row.charge_line_id);
        return (
          <div
            key={row.charge_line_id}
            className="grid items-start gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(9rem,0.6fr)_minmax(0,1.4fr)]"
          >
            <div className="min-w-0 text-sm">
              <p className="num font-semibold">
                <span className="whitespace-nowrap">{row.snapshot.use_date}</span> ·{' '}
                <span className="whitespace-nowrap">{row.snapshot.use_no}</span>
              </p>
              <p className="text-slate-700">
                <span className="whitespace-nowrap">{chargeTypeLabel(row.snapshot.charge_type)}</span> ·{' '}
                <span className="whitespace-nowrap">
                  {chargeUnitLabel(row.snapshot.charge_type, row.snapshot.billing_unit)}
                  {row.snapshot.quantity != null && ` ${formatQuantity(row.snapshot.quantity)}`}
                </span>{' '}
                ·{' '}
                <span className="num whitespace-nowrap">
                  {money(row.snapshot.supply_amount ?? row.estimated_supply)}
                </span>
              </p>
              {!row.eligible && <p className="mt-1 text-amber-800">{row.reasons.join(' · ')}</p>}
            </div>
            <Field label={`${row.snapshot.use_no} 포함 여부`}>
              <select
                className={inputClass}
                value={choice.inclusion}
                onChange={(event) =>
                  choose(row.charge_line_id, { inclusion: event.target.value as Choice['inclusion'] })
                }
              >
                <option value="INCLUDED" disabled={!row.eligible}>
                  포함
                </option>
                <option value="HELD">보류</option>
                <option value="EXCLUDED">제외</option>
              </select>
            </Field>
            {choice.inclusion === 'HELD' && (
              <div className="min-w-0 text-sm font-medium text-slate-700">
                <label htmlFor={holdId} className="block">
                  {`${row.snapshot.use_no} 보류 사유`}
                </label>
                <textarea
                  id={holdId}
                  className={`${inputClass} resize-y ${holdMissing ? 'border-red-600 ring-3 ring-red-100' : ''}`}
                  aria-invalid={holdMissing || undefined}
                  aria-describedby={holdMissing ? `${holdId}-error` : undefined}
                  required
                  rows={2}
                  value={choice.hold_reason}
                  maxLength={1000}
                  onChange={(event) => choose(row.charge_line_id, { hold_reason: event.target.value })}
                />
                {holdMissing && (
                  <p id={`${holdId}-error`} className="mt-1 font-semibold text-red-700">
                    보류 사유를 입력해 주세요.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
      {missingHold.size > 0 && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800"
        >
          보류 사유를 입력해 주세요. ({missingHold.size}건)
        </p>
      )}
      <button className={secondaryClass} disabled={busy || loading}>
        초안 변경 저장
      </button>
    </form>
  );
}
