'use client';
import { useBusy } from '@/components/ui/use-busy';
import { useState, type FormEvent } from 'react';
import {
  api,
  buttonClass,
  dateTime,
  ErrorMessage,
  Field,
  inputClass,
  money,
  secondaryClass,
  type StatementDetail,
} from '../statements/ui';
export function PaymentPanel({ statement, onChange }: { statement: StatementDetail; onChange: () => void }) {
  const word = statement.direction === 'PAYABLE' ? '지급' : '입금';
  const { busy, begin, end } = useBusy();
  const [error, setError] = useState('');
  const [voidId, setVoidId] = useState('');
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  async function record(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!begin()) return false;
    setError('');
    try {
      await api(`/api/statements/${statement.id}/payments`, {
        client_request_id: clientId,
        kind: statement.direction === 'PAYABLE' ? 'PAYMENT' : 'RECEIPT',
        amount: statement.grand_total,
        paid_on: form.get('paid_on'),
        method: form.get('method'),
        reference: form.get('reference'),
        memo: form.get('memo'),
      });
      setClientId(crypto.randomUUID());
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      end();
    }
  }
  async function undo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!begin()) return false;
    setError('');
    try {
      await api(`/api/payments/${voidId}/void`, { reason: form.get('reason') });
      setVoidId('');
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      end();
    }
  }
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-bold">
        {word} 기록{' '}
        <span
          className={`ml-2 rounded-full px-3 py-1 text-sm ${statement.status === 'CANCELED' ? 'bg-red-100 text-red-800' : statement.payment_status === 'PAID' ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}`}
        >
          {statement.status === 'CANCELED'
            ? '—(취소됨)'
            : statement.status === 'DRAFT'
              ? '—(작성 중)'
              : statement.payment_status === 'PAID'
                ? `${word} 완료`
                : `미${word}`}
        </span>
      </h2>
      <ErrorMessage error={error} />
      {statement.status === 'CONFIRMED' && statement.payment_status === 'UNPAID' && (
        <form onSubmit={record} className="space-y-4 rounded-lg bg-slate-50 p-4">
          <p className="font-semibold">
            명세 전액 {money(statement.grand_total)}을 모두 {word}했는지 확인하세요.
          </p>
          <p className="text-sm text-slate-600">
            전액을 한 번만 기록합니다. 나눠 보낸 금액은 기록할 수 없으며, 메모에 적어도 기록 금액은 바뀌지
            않습니다.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={`${word}일`}>
              <input
                name="paid_on"
                type="date"
                className={inputClass}
                required
                defaultValue={new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())}
              />
            </Field>
            <Field label="방법">
              <select name="method" className={inputClass}>
                <option>계좌이체</option>
                <option>현금</option>
                <option>기타</option>
              </select>
            </Field>
            <Field label="참고번호">
              <input name="reference" className={inputClass} maxLength={200} />
            </Field>
            <Field label="메모">
              <input name="memo" className={inputClass} maxLength={2000} />
            </Field>
          </div>
          <button className={`${buttonClass} max-w-full whitespace-normal`} disabled={busy}>
            {busy ? '처리 중…' : `${money(statement.grand_total)} ${word} 완료로 기록`}
          </button>
        </form>
      )}
      {!statement.payments.length && <p className="text-sm text-slate-600">아직 {word} 기록이 없습니다.</p>}
      <ul className="space-y-3">
        {statement.payments.map((p) => (
          <li key={p.id} className="rounded-lg border border-slate-200 p-4 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <strong>
                {p.paid_on} · {money(p.amount)} · {p.method}
              </strong>
              {p.voided_at ? (
                <span className="text-red-700">오입력 취소</span>
              ) : (
                <button
                  type="button"
                  className={secondaryClass}
                  disabled={busy}
                  onClick={() => setVoidId(voidId === p.id ? '' : p.id)}
                >
                  오입력 취소
                </button>
              )}
            </div>
            <p className="mt-2 text-slate-600">
              참고번호: {p.reference || '-'} · 메모: {p.memo || '-'}
            </p>
            <p className="mt-1 text-slate-600">기록: {dateTime(p.recorded_at)}</p>
            {p.voided_at && (
              <p className="mt-2 text-red-700">
                취소: {dateTime(p.voided_at)} · {p.void_reason}
              </p>
            )}
            {voidId === p.id && !p.voided_at && (
              <form onSubmit={undo} className="mt-3 space-y-3">
                <Field label="오입력 취소 사유">
                  <input name="reason" className={inputClass} required maxLength={1000} />
                </Field>
                <button className={buttonClass} disabled={busy}>
                  기록 취소 확인
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
