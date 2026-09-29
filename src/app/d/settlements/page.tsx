'use client';
import { useState, type FormEvent } from 'react';
import type { driverSettlements } from '@/server/services/statements-driver';
import {
  ErrorMessage,
  Field,
  inputClass,
  money,
  monthPeriod,
  panelClass,
  secondaryClass,
  useResource,
} from '../../m/statements/ui';
const reviews: Record<string, string> = {
  DRAFT: '작성 중',
  SUBMITTED: '제출',
  APPROVED: '승인',
  NEEDS_FIX: '보완 필요',
};
export default function DriverSettlementsPage() {
  const [period, setPeriod] = useState(() => monthPeriod());
  const result = useResource<Awaited<ReturnType<typeof driverSettlements>>>(
    `/api/statements/mine?${new URLSearchParams({ periodStart: period.start, periodEnd: period.end })}`,
  );
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPeriod({ start: String(form.get('start')), end: String(form.get('end')) });
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">내 정산</h1>
        <p className="mt-2 text-sm text-slate-600">본인 사용 건과 본인에게 해당하는 지급명세 금액입니다.</p>
      </div>
      <form onSubmit={search} className={`${panelClass} grid gap-3`}>
        <Field label="조회 시작일">
          <input name="start" type="date" defaultValue={period.start} className={inputClass} required />
        </Field>
        <Field label="조회 종료일">
          <input name="end" type="date" defaultValue={period.end} className={inputClass} required />
        </Field>
        <button className={secondaryClass}>조회</button>
      </form>
      <ErrorMessage error={result.error} />
      {result.loading && <p role="status">내 정산을 불러오는 중…</p>}
      {result.data && (
        <>
          <dl className="grid grid-cols-2 gap-3">
            {[
              ['제출', result.data.summary.submitted],
              ['승인', result.data.summary.approved],
              ['보류 비용', result.data.summary.held],
              ['보완 필요', result.data.summary.needs_fix],
            ].map(([label, count]) => (
              <div key={label} className={panelClass}>
                <dt className="text-sm text-slate-600">{label}</dt>
                <dd className="mt-2 text-2xl font-bold">{count}건</dd>
              </div>
            ))}
          </dl>
          <section className="space-y-3">
            <h2 className="text-xl font-bold">내 사용 건</h2>
            {!result.data.uses.length && <p className="text-slate-500">조회 기간의 사용 건이 없습니다.</p>}
            {result.data.uses.map((use) => (
              <article key={use.id} className={`${panelClass} space-y-2`}>
                <p className="font-semibold">
                  {use.use_date} · {use.project_name}
                </p>
                <p className="text-sm">
                  {use.use_no} · {reviews[use.review_status]}
                </p>
                <p>인정 공급가 {money(use.approved_supply)}</p>
                {use.held_count > 0 && <p className="text-sm text-amber-800">보류 비용 {use.held_count}건</p>}
              </article>
            ))}
          </section>
          <section className="space-y-3">
            <h2 className="text-xl font-bold">확정 지급명세 · 내 해당분</h2>
            {!result.data.statements.length && (
              <p className="text-slate-500">조회 기간의 확정 지급명세가 없습니다.</p>
            )}
            {result.data.statements.map((s) => (
              <article key={s.id} className={`${panelClass} space-y-3`}>
                <h3 className="break-all font-bold">{s.statement_no}</h3>
                <p className="text-sm">
                  {s.period_start} ~ {s.period_end}
                </p>
                <p className={s.paid ? 'font-bold text-emerald-700' : 'text-amber-800'}>
                  {s.paid ? '지급 완료' : '미지급'}
                </p>
                <p className="text-xl font-bold">내 해당분 {money(s.grand_total)}</p>
                <p className="text-sm text-slate-600">
                  공급가 {money(s.supply_total)} · 세액 {money(s.tax_total)}
                </p>
                <ul className="space-y-2">
                  {s.items.map((item, index) => (
                    <li key={index} className="border-t pt-3 text-sm">
                      <p>
                        {item.use_date} · {item.use_no} {item.carried_forward && '· 전월분'}
                      </p>
                      <p>
                        {item.project_name} · {item.plate_no}
                      </p>
                      <p>{item.cargo_desc}</p>
                      <p>
                        공급가 {money(item.supply_amount)} · 세액 {money(item.tax_amount)}
                      </p>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
