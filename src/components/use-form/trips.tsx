'use client';
import type { UseDetail } from '@/client/types';
import { operationLabels } from '@/client/types';
import { Field, button, control, Section } from './fields';
import { newTrip, type FormCharge, type FormTrip } from './model';
export function TripFields({
  trips,
  onChange,
  recent,
  billingUnits = [],
}: {
  trips: FormTrip[];
  onChange: (trips: FormTrip[]) => void;
  recent: UseDetail[];
  billingUnits?: FormCharge['billing_unit'][];
}) {
  const showQuantity = billingUnits.some((unit) => unit === 'PER_TON' || unit === 'PER_M3');
  const showHours = billingUnits.includes('PER_HOUR');
  const routes = [
    ...new Map(recent.flatMap((u) => u.trips).map((t) => [`${t.origin} → ${t.destination}`, t])).entries(),
  ].slice(0, 8);
  const change = (i: number, patch: Partial<FormTrip>) =>
    onChange(trips.map((t, j) => (i === j ? { ...t, ...patch } : t)));
  const move = (i: number, offset: number) => {
    const next = [...trips];
    [next[i], next[i + offset]] = [next[i + offset], next[i]];
    onChange(next);
  };
  const inputField = (
    trip: FormTrip,
    index: number,
    key: 'origin' | 'destination' | 'via' | 'cargo_desc' | 'quantity' | 'quantity_unit' | 'hours',
  ) => (
    <Field
      key={key}
      target={`trip:${index + 1}.${key}`}
      label={`${index + 1}회차 ${{ origin: '출발', destination: '도착', via: '경유 (쉼표 구분)', cargo_desc: '화물', quantity: '수량', quantity_unit: '수량 단위', hours: '시간' }[key]}`}
    >
      <input
        className={control}
        value={trip[key] ?? ''}
        inputMode={['quantity', 'hours'].includes(key) ? 'decimal' : 'text'}
        onChange={(e) => change(index, { [key]: e.target.value })}
      />
    </Field>
  );
  return (
    <Section title={`운행 목록 · ${trips.length}회`} target="trips">
      <div className="grid gap-5">
        {trips.map((t, i) => (
          <fieldset key={t.client_row_id} className="min-w-0 rounded-xl border border-slate-200 p-3">
            <legend className="px-2 font-bold">{i + 1}회차</legend>
            <div className="mb-4 flex flex-wrap gap-2">
              <button
                type="button"
                className={button}
                disabled={i === 0}
                aria-label={`${i + 1}회차 위로`}
                onClick={() => move(i, -1)}
              >
                ↑ 위로
              </button>
              <button
                type="button"
                className={button}
                disabled={i === trips.length - 1}
                aria-label={`${i + 1}회차 아래로`}
                onClick={() => move(i, 1)}
              >
                ↓ 아래로
              </button>
              <button
                type="button"
                className={`${button} ml-auto text-red-700`}
                aria-label={`${i + 1}회차 삭제`}
                onClick={() => onChange(trips.filter((_, j) => j !== i))}
              >
                삭제
              </button>
            </div>
            {routes.length > 0 && (
              <Field label={`${i + 1}회차 최근 경로`}>
                <select
                  className={control}
                  value=""
                  onChange={(e) => {
                    const route = routes[Number(e.target.value)]?.[1];
                    if (route)
                      change(i, {
                        origin: route.origin,
                        destination: route.destination,
                        via: route.via?.join(', ') ?? '',
                      });
                  }}
                >
                  <option value="">최근 경로 불러오기</option>
                  {routes.map(([name], index) => (
                    <option key={name} value={index}>
                      {name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {(['origin', 'destination', 'cargo_desc'] as const).map((key) => inputField(t, i, key))}
              <Field label={`${i + 1}회차 운행 상태`} target={`trip:${i + 1}.status`}>
                <select
                  className={control}
                  value={t.status}
                  onChange={(e) => change(i, { status: e.target.value as FormTrip['status'] })}
                >
                  {Object.entries(operationLabels).map(([v, name]) => (
                    <option key={v} value={v}>
                      {name}
                    </option>
                  ))}
                </select>
              </Field>
              {showQuantity && inputField(t, i, 'quantity')}
              {showHours && inputField(t, i, 'hours')}
            </div>
            <details className="mt-4 rounded-xl bg-slate-50 p-3">
              <summary className="min-h-11 cursor-pointer py-2 font-semibold text-slate-700">
                {i + 1}회차 상세 입력
              </summary>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                {inputField(t, i, 'via')}
                {!showQuantity && inputField(t, i, 'quantity')}
                {inputField(t, i, 'quantity_unit')}
                {!showHours && inputField(t, i, 'hours')}
                <Field label={`${i + 1}회차 출발시각 (서울)`} target={`trip:${i + 1}.depart_at`}>
                  <input
                    className={control}
                    type="datetime-local"
                    value={t.depart_at}
                    onChange={(e) => change(i, { depart_at: e.target.value })}
                  />
                </Field>
                <Field label={`${i + 1}회차 도착시각 (서울)`} target={`trip:${i + 1}.arrive_at`}>
                  <input
                    className={control}
                    type="datetime-local"
                    value={t.arrive_at}
                    onChange={(e) => change(i, { arrive_at: e.target.value })}
                  />
                </Field>
                <Field label={`${i + 1}회차 공차회차`} target={`trip:${i + 1}.is_empty_return`}>
                  <input
                    className="h-7 w-7"
                    type="checkbox"
                    checked={t.is_empty_return}
                    onChange={(e) => change(i, { is_empty_return: e.target.checked })}
                  />
                </Field>
                <Field label={`${i + 1}회차 비고`} target={`trip:${i + 1}.notes`}>
                  <input
                    className={control}
                    value={t.notes ?? ''}
                    onChange={(e) => change(i, { notes: e.target.value })}
                  />
                </Field>
              </div>
            </details>
          </fieldset>
        ))}
      </div>
      <button
        type="button"
        className={`${button} mt-5 w-full`}
        onClick={() => onChange([...trips, newTrip()])}
      >
        + 운행 추가
      </button>
    </Section>
  );
}
