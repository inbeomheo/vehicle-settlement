'use client';
import { useState, type FormEvent } from 'react';
import { chargeTypeLabel, chargeUnitLabel } from '@/components/manager/charge-display';
import {
  api,
  ErrorMessage,
  Field,
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
  const existingRows: Candidate[] = statement.items.map((item) => ({
    charge_line_id: item.charge_line_id,
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
    const items: DraftChanges['items'] = [];
    for (const row of rows) {
      const choice = choices[row.charge_line_id];
      if (!choice || choice.inclusion === 'EXCLUDED') continue;
      items.push({
        charge_line_id: row.charge_line_id,
        inclusion: choice.inclusion,
        hold_reason: choice.inclusion === 'HELD' ? choice.hold_reason : null,
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
  return (
    <form onSubmit={save} className="space-y-4">
      <Field label={statement.direction === 'PAYABLE' ? '지급 예정일' : '입금 예정일'}>
        <input className={inputClass} name="due_date" type="date" defaultValue={statement.due_date ?? ''} />
      </Field>
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
          <p className="text-sm text-slate-500">추가할 미정산 후보가 없습니다.</p>
        )}
      </div>
      <ErrorMessage error={error} />
      {rows.map((row) => {
        const choice = choices[row.charge_line_id] ?? { inclusion: 'EXCLUDED', hold_reason: '' };
        return (
          <div
            key={row.charge_line_id}
            className="grid items-end gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-3"
          >
            <div className="text-sm">
              <p>
                {row.snapshot.use_date} · {row.snapshot.use_no}
              </p>
              <p>
                {chargeTypeLabel(row.snapshot.charge_type)} ·{' '}
                {chargeUnitLabel(row.snapshot.charge_type, row.snapshot.billing_unit)} ·
                {money(row.snapshot.supply_amount)}
              </p>
              {!row.eligible && <p className="mt-1 text-amber-800">{row.reasons.join(' · ')}</p>}
            </div>
            <Field label={`${row.snapshot.use_no} 포함 여부`}>
              <select
                className={inputClass}
                value={choice.inclusion}
                onChange={(event) =>
                  setChoices({
                    ...choices,
                    [row.charge_line_id]: { ...choice, inclusion: event.target.value as Choice['inclusion'] },
                  })
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
              <Field label={`${row.snapshot.use_no} 보류 사유`}>
                <input
                  className={inputClass}
                  required
                  value={choice.hold_reason}
                  maxLength={1000}
                  onChange={(event) =>
                    setChoices({
                      ...choices,
                      [row.charge_line_id]: { ...choice, hold_reason: event.target.value },
                    })
                  }
                />
              </Field>
            )}
          </div>
        );
      })}
      <button className={secondaryClass} disabled={busy || loading}>
        초안 변경 저장
      </button>
    </form>
  );
}
