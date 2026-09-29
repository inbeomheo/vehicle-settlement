'use client';
import { useBusy } from '@/components/ui/use-busy';
import Link from 'next/link';
import { ConfirmDialog } from '@/components/ui/modal';
import { chargeTypeLabel } from '@/components/manager/charge-display';
import { useParams, useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { PaymentPanel } from '../../payments/payment-panel';
import { NewStatement } from '../new-statement';
import { DraftEditor } from '../draft-editor';
import { StatementItems } from '../statement-items';
import {
  api,
  buttonClass,
  dateTime,
  ErrorMessage,
  Field,
  inputClass,
  money,
  panelClass,
  secondaryClass,
  statusLabels,
  StatementBadge,
  Totals,
  DraftWarnings,
  useResource,
  type StatementDetail,
} from '../ui';
export default function StatementPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const result = useResource<StatementDetail>(`/api/statements/${id}`);
  const [error, setError] = useState('');
  const { busy, begin, end } = useBusy();
  const [canceling, setCanceling] = useState(false);
  const [confirmingToken, setConfirmingToken] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [notice, setNotice] = useState('');
  const statement = result.data;
  async function action(path: string, data: unknown, method = 'POST') {
    if (!begin()) return false;
    setError('');
    setNotice('');
    try {
      await api(path, data, method);
      result.reload();
      return true;
    } catch (e) {
      setError((e as Error).message);
      if ((e as { code?: string }).code === 'STATEMENT_CHANGED') {
        setConfirmingToken(null);
        result.reload();
      }
      return false;
    } finally {
      end();
    }
  }
  async function cancel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!statement) return;
    if (
      await action(`/api/statements/${id}/cancel`, {
        version: statement.version,
        reason: new FormData(event.currentTarget).get('reason'),
      })
    )
      setCanceling(false);
  }
  async function adjust(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (
      await action('/api/adjustments', {
        adjusts_statement_id: id,
        charge_line_id: form.get('charge_line_id'),
        supply_amount: Number(form.get('supply_amount')),
        reason: form.get('reason'),
        ...(form.get('effective_date') ? { effective_date: form.get('effective_date') } : {}),
      })
    )
      setNotice('조정 비용을 만들었습니다. 다음 정산 후보에서 확인하세요.');
  }
  if (!statement)
    return (
      <div className="space-y-4">
        <Link href="/m/statements" className="inline-flex min-h-11 items-center text-blue-700 underline">
          월 정산
        </Link>
        <ErrorMessage error={result.error} onRetry={result.reload} />
        {result.loading && <p role="status">명세를 불러오는 중…</p>}
      </div>
    );
  const included = statement.items.filter((i) => i.inclusion === 'INCLUDED');
  const held = statement.items.filter((i) => i.inclusion === 'HELD');
  return (
    <div className="min-w-0 space-y-6">
      <Link
        href="/m/statements"
        className="inline-flex min-h-11 items-center text-sm font-semibold text-slate-600 hover:text-ink"
      >
        ‹ 월 정산 목록
      </Link>
      <header className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <StatementBadge status={statement.status} />
              {statement.direction === 'PAYABLE' ? '운송사 지급명세' : '원청 청구명세'}
            </p>
            <h1 className="mt-2 break-all text-[1.75rem] font-bold">
              {String(statement.counterparty_snapshot?.name ?? '거래처')}
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <a className={secondaryClass} href={`/api/statements/${id}/export.pdf`} download>
              PDF 다운로드
            </a>
            <a className={secondaryClass} href={`/api/statements/${id}/export.xlsx`} download>
              엑셀 다운로드
            </a>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-dashed border-slate-300 bg-slate-50 px-5 py-4 text-sm sm:grid-cols-3 sm:px-6">
          <div>
            <dt className="text-slate-500">문서번호</dt>
            <dd className="num mt-0.5 font-semibold break-all">{statement.statement_no ?? '확정 시 부여'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">정산 기간</dt>
            <dd className="num mt-0.5 font-semibold">
              {statement.period_start} ~ {statement.period_end}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">포함</dt>
            <dd className="mt-0.5 font-semibold">{included.length}건</dd>
          </div>
        </dl>
      </header>
      <ErrorMessage
        error={confirmingToken ? result.error : error || result.error}
        onRetry={result.error ? result.reload : undefined}
      />
      {notice && (
        <p role="status" className="rounded-lg bg-emerald-50 p-4 text-emerald-900">
          {notice}
        </p>
      )}
      <Totals {...statement} />
      {statement.status === 'DRAFT' && <DraftWarnings {...statement} />}
      <section className={`${panelClass} space-y-4`}>
        <h2 className="text-lg font-bold">포함 내역 · {included.length}건</h2>
        <StatementItems items={included} />
        {!included.length && <p>포함 항목이 없습니다.</p>}
        <h3 className="pt-3 font-semibold">보류 내역 · {held.length}건</h3>
        {!held.length ? (
          <p className="text-sm text-slate-600">보류 항목이 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {held.map((item) => (
              <li key={item.id} className="rounded bg-amber-50 p-3 text-sm">
                {String(item.snapshot?.use_no)} · {item.hold_reason} · {money(item.supply_amount)} (합계 제외)
              </li>
            ))}
          </ul>
        )}
      </section>
      {statement.status === 'DRAFT' && (
        <section className={`${panelClass} space-y-5`}>
          <h2 className="text-lg font-bold">초안 편집</h2>
          <DraftEditor
            key={statement.version}
            statement={statement}
            busy={busy}
            onSave={(changes) => action(`/api/statements/${id}/items`, changes, 'PATCH')}
          />
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
            <p className="mb-3 text-sm">
              저장된 포함 항목과 합계로 확정합니다. 확정 후 수정은 취소·재작성 또는 조정으로 처리합니다.
            </p>
            <button
              className={buttonClass}
              disabled={busy}
              onClick={() => {
                setError('');
                setConfirmingToken(statement.confirmation_token);
              }}
            >
              명세 확정
            </button>
            {confirmingToken !== null && confirmingToken === statement.confirmation_token && (
              <ConfirmDialog
                title="명세 확정 확인"
                confirmLabel="확정"
                busy={busy}
                error={error}
                onClose={() => setConfirmingToken(null)}
                onConfirm={() =>
                  void action(`/api/statements/${id}/confirm`, {
                    version: statement.version,
                    confirmation_token: confirmingToken,
                  }).then((ok) => {
                    if (ok) {
                      setConfirmingToken(null);
                      setNotice('명세를 확정했습니다.');
                    }
                  })
                }
              >
                <p className="font-bold">
                  포함 {included.length}건 · 총액 {money(statement.grand_total)}
                </p>
                <p>
                  이 내용으로 명세를 확정하시겠습니까? 확정 후 수정은 취소·재작성 또는 조정으로 처리합니다.
                </p>
              </ConfirmDialog>
            )}
          </div>
        </section>
      )}
      <section className={`${panelClass} space-y-4`}>
        <h2 className="text-lg font-bold">명세 이력</h2>
        <p className="text-sm">
          확정 시각: {dateTime(statement.confirmed_at)} · 담당자:{' '}
          {String(statement.issuer_snapshot?.prepared_by ?? '-')} · 예정일: {statement.due_date ?? '-'}
        </p>
        {statement.replaces_statement_id && (
          <p className="text-sm">
            <Link
              className="inline-flex min-h-11 items-center text-blue-700 underline"
              href={`/m/statements/${statement.replaces_statement_id}`}
            >
              재작성 전 취소 명세 보기
            </Link>
          </p>
        )}
        {statement.status === 'CANCELED' ? (
          <>
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
              취소 시각: {dateTime(statement.canceled_at)}
              <br />
              취소 사유: {statement.cancel_reason}
            </p>
            <button className={secondaryClass} onClick={() => setReplacing(!replacing)}>
              새 명세로 재작성
            </button>
            {statement.replacements.map((s) => (
              <p key={s.id}>
                <Link
                  className="inline-flex min-h-11 items-center text-sm text-blue-700 underline"
                  href={`/m/statements/${s.id}`}
                >
                  재작성 명세: {s.statement_no ?? '작성 중'} ({statusLabels[s.status]})
                </Link>
              </p>
            ))}
          </>
        ) : (
          <>
            <button
              className={secondaryClass}
              disabled={busy || statement.payment_status === 'PAID'}
              onClick={() => setCanceling(!canceling)}
            >
              명세 취소
            </button>
            {statement.payment_status === 'PAID' && (
              <p className="text-sm text-slate-600">
                유효 지급·입금 기록을 먼저 취소해야 명세를 취소할 수 있습니다.
              </p>
            )}
          </>
        )}
        {canceling && (
          <form onSubmit={cancel} className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm">
              포함 {included.length}건 · 총액 {money(statement.grand_total)} 명세를 취소합니다. 사유를
              확인하고 취소를 확정하세요.
            </p>
            <Field label="명세 취소 사유">
              <input name="reason" className={inputClass} required maxLength={1000} />
            </Field>
            <button className={buttonClass} disabled={busy}>
              명세 취소 확인
            </button>
          </form>
        )}
      </section>
      {replacing && (
        <NewStatement
          direction={statement.direction}
          replaces={statement}
          onCreated={(next) => router.push(`/m/statements/${next}`)}
        />
      )}
      <div className={panelClass}>
        <PaymentPanel statement={statement} onChange={result.reload} />
      </div>
      {statement.payment_status === 'PAID' && (
        <section className={`${panelClass} space-y-4`}>
          <h2 className="text-lg font-bold">다음 정산에 조정 반영</h2>
          <p className="text-sm text-slate-600">
            원명세는 유지하고 다음 정산에 포함할 조정 비용을 만듭니다. 감액은 음수로 입력하세요.
          </p>
          <form onSubmit={adjust} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="원명세 항목">
                <select name="charge_line_id" className={inputClass} required>
                  {included.map((i) => (
                    <option key={i.id} value={i.charge_line_id}>
                      {String(i.snapshot?.use_no)} ·{' '}
                      {chargeTypeLabel(i.snapshot?.charge_type as string | undefined)} ·{' '}
                      {money(i.supply_amount)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="조정 공급가(원)">
                <input
                  name="supply_amount"
                  type="number"
                  step="1"
                  min="-2147483647"
                  max="2147483647"
                  className={inputClass}
                  required
                />
              </Field>
              <Field label="조정 사유">
                <input name="reason" className={inputClass} required maxLength={1000} />
              </Field>
              <Field label="반영 기준일(선택)">
                <input name="effective_date" type="date" className={inputClass} />
              </Field>
            </div>
            <button className={buttonClass} disabled={busy}>
              조정 비용 생성
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
