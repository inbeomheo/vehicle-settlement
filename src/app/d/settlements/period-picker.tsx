'use client';
import { useState } from 'react';
import { button, control, primary } from '@/components/use-form/fields';
import { driverSettlementPeriodSchema } from '@/shared/driver-settlement-period';

export function PeriodPicker({
  start,
  end,
  onApply,
}: {
  start: string;
  end: string;
  onApply: (from: string, to: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(end);
  const [error, setError] = useState('');
  return (
    <div className="min-w-0 space-y-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="settlement-period"
        className={`${button} text-sm`}
        onClick={() => setOpen(!open)}
      >
        기간 직접 고르기
      </button>
      {open && (
        <form
          id="settlement-period"
          className="min-w-0 space-y-3 rounded-lg border border-slate-200 bg-white p-4"
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = driverSettlementPeriodSchema.safeParse({ periodStart: from, periodEnd: to });
            if (!parsed.success) {
              setError(parsed.error.issues[0].message);
              return;
            }
            setError('');
            setOpen(false);
            onApply(from, to);
          }}
        >
          <label className="block min-w-0 font-semibold">
            시작일
            <input
              type="date"
              required
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className={`${control} mt-1 max-w-full`}
            />
          </label>
          <label className="block min-w-0 font-semibold">
            종료일
            <input
              type="date"
              required
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className={`${control} mt-1 max-w-full`}
            />
          </label>
          <p className="text-sm text-slate-700">최대 1년까지 고를 수 있습니다.</p>
          {error && (
            <p role="alert" className="text-sm font-semibold text-red-800">
              {error}
            </p>
          )}
          <button type="submit" className={`${primary} w-full`}>
            이 기간 보기
          </button>
        </form>
      )}
    </div>
  );
}
