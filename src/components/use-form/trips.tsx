'use client';
import { useContext, useEffect, useState } from 'react';
import type { UseDetail } from '@/client/types';
import { operationLabels } from '@/client/types';
import {
  Field,
  button,
  control,
  Section,
  SettingsContext,
  FixContext,
  ValidationContext,
  RevealedFieldsContext,
  hasFieldValue,
} from './fields';
import { tripLayout, tripRevealTarget } from './visibility';
import { fieldKeyForTarget } from '@/shared/form-settings';
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
  const settings = useContext(SettingsContext);
  const fixes = useContext(FixContext);
  const errors = useContext(ValidationContext);
  const attention = [...fixes, ...errors];
  const revealed = useContext(RevealedFieldsContext);
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () =>
      new Set(
        trips
          .slice(0, -1)
          .filter((trip) => trip.origin.trim() && trip.destination.trim())
          .map((trip) => trip.client_row_id),
      ),
  );
  useEffect(() => {
    const expand = (event: Event) => {
      const index = (event as CustomEvent<number>).detail;
      setCollapsed((previous) => {
        const next = new Set(previous);
        next.delete(trips[index]?.client_row_id);
        return next;
      });
    };
    window.addEventListener('vehicle-expand-trip', expand);
    return () => window.removeEventListener('vehicle-expand-trip', expand);
  }, [trips]);
  const collapseCompleted = () =>
    setCollapsed(
      new Set(
        trips
          .filter((trip) => trip.origin.trim() && trip.destination.trim())
          .map((trip) => trip.client_row_id),
      ),
    );
  const addTrip = (copy = false) => {
    collapseCompleted();
    const previous = trips.at(-1);
    onChange([
      ...trips,
      {
        ...newTrip(),
        ...(copy && previous
          ? {
              origin: previous.origin,
              destination: previous.destination,
              cargo_desc: previous.cargo_desc,
            }
          : {}),
      },
    ]);
  };
  const { showQuantity, showHours, detailKeys } = tripLayout(settings, billingUnits);
  const detailValue = (trip: FormTrip, key: (typeof detailKeys)[number]) =>
    key === 'is_empty_return'
      ? trip.is_empty_return
      : hasFieldValue(trip[key === 'trip_notes' ? 'notes' : key]);
  const requiredDetails = detailKeys.some((key) => settings[key] === 'REQUIRED');
  const hasDetailFix = (index: number) =>
    attention.some(
      (fix) =>
        fix.target.startsWith(`trip:${index + 1}.`) &&
        detailKeys.some((key) => key === fieldKeyForTarget(fix.target)),
    );
  const isCollapsed = (trip: FormTrip, index: number) =>
    collapsed.has(trip.client_row_id) &&
    !attention.some((fix) => fix.target.startsWith(`trip:${index + 1}.`));
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
      revealTarget={tripRevealTarget(trip, key)}
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
            <legend className={isCollapsed(t, i) ? 'sr-only' : 'px-2 font-bold'}>{i + 1}회차</legend>
            {isCollapsed(t, i) && (
              <button
                type="button"
                className="flex min-h-11 w-full min-w-0 items-center gap-2 text-left"
                aria-label={`${i + 1}회차 펼치기`}
                aria-expanded={false}
                onClick={() =>
                  setCollapsed((previous) => {
                    const next = new Set(previous);
                    next.delete(t.client_row_id);
                    return next;
                  })
                }
              >
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {i + 1}회차 · {t.origin} → {t.destination}
                  {(settings.cargo !== 'HIDDEN' || t.cargo_desc) && ` · ${t.cargo_desc || '화물 없음'}`}
                </span>
                <span aria-hidden="true">⌄</span>
              </button>
            )}
            <div hidden={isCollapsed(t, i)}>
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
                <Field
                  label={`${i + 1}회차 운행 상태`}
                  target={`trip:${i + 1}.status`}
                  revealTarget={tripRevealTarget(t, 'status')}
                  hasValue={t.status !== 'COMPLETED'}
                >
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
              {(hasDetailFix(i) ||
                detailKeys.some(
                  (key) =>
                    settings[key] !== 'HIDDEN' ||
                    detailValue(t, key) ||
                    revealed.has(tripRevealTarget(t, key === 'trip_notes' ? 'notes' : key)),
                )) && (
                <details
                  open={
                    hasDetailFix(i) ||
                    revealed.has(tripRevealTarget(t, 'details')) ||
                    requiredDetails ||
                    detailKeys.some((key) => detailValue(t, key)) ||
                    undefined
                  }
                  className="mt-4 rounded-xl bg-slate-50 p-3"
                >
                  <summary className="min-h-11 cursor-pointer py-2 font-semibold text-slate-700">
                    {i + 1}회차 상세 입력
                  </summary>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    {inputField(t, i, 'via')}
                    {!showQuantity && inputField(t, i, 'quantity')}
                    {inputField(t, i, 'quantity_unit')}
                    {!showHours && inputField(t, i, 'hours')}
                    <Field
                      label={`${i + 1}회차 출발시각 (서울)`}
                      target={`trip:${i + 1}.depart_at`}
                      revealTarget={tripRevealTarget(t, 'depart_at')}
                    >
                      <input
                        className={control}
                        type="datetime-local"
                        value={t.depart_at}
                        onChange={(e) => change(i, { depart_at: e.target.value })}
                      />
                    </Field>
                    <Field
                      label={`${i + 1}회차 도착시각 (서울)`}
                      target={`trip:${i + 1}.arrive_at`}
                      revealTarget={tripRevealTarget(t, 'arrive_at')}
                    >
                      <input
                        className={control}
                        type="datetime-local"
                        value={t.arrive_at}
                        onChange={(e) => change(i, { arrive_at: e.target.value })}
                      />
                    </Field>
                    <Field
                      label={`${i + 1}회차 공차회차`}
                      target={`trip:${i + 1}.is_empty_return`}
                      revealTarget={tripRevealTarget(t, 'is_empty_return')}
                      hasValue={t.is_empty_return}
                    >
                      <input
                        className="h-11 w-11 text-base"
                        type="checkbox"
                        checked={t.is_empty_return}
                        onChange={(e) => change(i, { is_empty_return: e.target.checked })}
                      />
                    </Field>
                    <Field
                      label={`${i + 1}회차 비고`}
                      target={`trip:${i + 1}.notes`}
                      revealTarget={tripRevealTarget(t, 'notes')}
                    >
                      <input
                        className={control}
                        value={t.notes ?? ''}
                        onChange={(e) => change(i, { notes: e.target.value })}
                      />
                    </Field>
                  </div>
                </details>
              )}
              {t.origin.trim() && t.destination.trim() && (
                <button
                  type="button"
                  className={`${button} mt-3 w-full`}
                  aria-label={`${i + 1}회차 입력 완료`}
                  onClick={() => setCollapsed((previous) => new Set([...previous, t.client_row_id]))}
                >
                  입력 완료 · 접기
                </button>
              )}
            </div>
          </fieldset>
        ))}
      </div>
      <button type="button" className={`${button} mt-5 w-full`} onClick={() => addTrip()}>
        + 운행 추가
      </button>
      {trips.length > 0 && (
        <button type="button" className={`${button} mt-3 w-full`} onClick={() => addTrip(true)}>
          직전 회차 복사
        </button>
      )}
    </Section>
  );
}
