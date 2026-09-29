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
  ) => {
    const names = {
      origin: '출발',
      destination: '도착',
      via: '경유 (쉼표 구분)',
      cargo_desc: '화물',
      quantity: '수량',
      quantity_unit: '수량 단위',
      hours: '시간',
    };
    return (
      <Field
        key={key}
        target={`trip:${index + 1}.${key}`}
        revealTarget={tripRevealTarget(trip, key)}
        label={names[key]}
        hiddenPrefix={`${index + 1}회차 `}
      >
        <input
          className={control}
          value={trip[key] ?? ''}
          inputMode={['quantity', 'hours'].includes(key) ? 'decimal' : 'text'}
          placeholder={key === 'origin' ? '상차지' : key === 'destination' ? '하차지' : undefined}
          onChange={(e) => change(index, { [key]: e.target.value })}
        />
      </Field>
    );
  };
  const routeBlock = (trip: FormTrip, index: number) => (
    <div className="grid grid-cols-[1.75rem_1fr_auto] gap-x-2">
      <div aria-hidden="true" className="flex flex-col items-center pt-10 pb-4">
        <span className="h-4 w-4 rounded-full border-[3px] border-blue-700 bg-white" />
        <span className="my-1 w-0 flex-1 border-l-2 border-dotted border-slate-400" />
        <svg width="18" height="22" viewBox="0 0 24 28" className="text-blue-700">
          <path
            fill="currentColor"
            d="M12 0a10 10 0 0 0-10 10c0 7.5 10 18 10 18s10-10.5 10-18A10 10 0 0 0 12 0Zm0 14a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z"
          />
        </svg>
      </div>
      <div className="grid min-w-0 gap-3">
        {inputField(trip, index, 'origin')}
        {inputField(trip, index, 'destination')}
      </div>
      <div className="flex items-center pt-7">
        <button
          type="button"
          className="flex h-12 w-12 items-center justify-center rounded-lg border border-slate-300 bg-white text-ink hover:bg-slate-50"
          aria-label={`${index + 1}회차 출발·도착 바꾸기`}
          onClick={() => change(index, { origin: trip.destination, destination: trip.origin })}
        >
          <svg
            aria-hidden="true"
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4" />
          </svg>
        </button>
      </div>
    </div>
  );
  const multiple = trips.length > 1;
  return (
    <Section title={multiple ? `운행 ${trips.length}회` : '출발 → 도착'} target="trips">
      <div className="grid gap-4">
        {trips.map((t, i) => (
          <fieldset
            key={t.client_row_id}
            className={`min-w-0 ${multiple ? 'rounded-lg border border-slate-200 p-3' : ''}`}
          >
            <legend
              className={isCollapsed(t, i) || !multiple ? 'sr-only' : 'px-1 text-sm font-bold text-slate-600'}
            >
              {i + 1}회차
            </legend>
            {isCollapsed(t, i) && (
              <button
                type="button"
                className="flex min-h-12 w-full min-w-0 items-center gap-3 text-left"
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
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {t.origin} → {t.destination}
                  {(settings.cargo !== 'HIDDEN' || t.cargo_desc) && (
                    <span className="font-normal text-slate-600"> · {t.cargo_desc || '화물 없음'}</span>
                  )}
                </span>
                <span aria-hidden="true" className="text-slate-400">
                  ⌄
                </span>
              </button>
            )}
            <div hidden={isCollapsed(t, i)}>
              {multiple && (
                <div className="mb-2 flex items-center gap-1.5">
                  <span className="mr-auto text-sm font-bold text-slate-600" aria-hidden="true">
                    {i + 1}회차
                  </span>
                  <button
                    type="button"
                    className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-300 bg-white disabled:opacity-40"
                    disabled={i === 0}
                    aria-label={`${i + 1}회차 위로`}
                    onClick={() => move(i, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-300 bg-white disabled:opacity-40"
                    disabled={i === trips.length - 1}
                    aria-label={`${i + 1}회차 아래로`}
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="min-h-11 rounded-lg px-3 text-sm font-semibold text-red-700 hover:bg-red-50"
                    aria-label={`${i + 1}회차 삭제`}
                    onClick={() => onChange(trips.filter((_, j) => j !== i))}
                  >
                    삭제
                  </button>
                </div>
              )}
              {routeBlock(t, i)}
              {routes.length > 0 && (
                <div role="group" aria-label={`${i + 1}회차 최근 경로`} className="mt-3">
                  <p aria-hidden="true" className="mb-1.5 text-sm font-semibold text-slate-600">
                    최근 경로
                  </p>
                  <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                    {routes.slice(0, 4).map(([name, route]) => (
                      <button
                        key={name}
                        type="button"
                        className={`inline-flex min-h-11 shrink-0 items-center rounded-full border px-3.5 text-[15px] font-semibold ${t.origin === route.origin && t.destination === route.destination ? 'border-blue-700 bg-blue-50 text-blue-900' : 'border-slate-300 bg-white text-ink'}`}
                        onClick={() =>
                          change(i, {
                            origin: route.origin,
                            destination: route.destination,
                            via: route.via?.join(', ') ?? '',
                          })
                        }
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {inputField(t, i, 'cargo_desc')}
                <Field
                  label="운행 상태"
                  hiddenPrefix={`${i + 1}회차 `}
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
                  className="mt-4 rounded-lg bg-slate-50 px-3 py-1"
                >
                  <summary className="min-h-11 cursor-pointer py-2.5 font-semibold text-slate-700">
                    {i + 1}회차 상세 입력
                  </summary>
                  <div className="mt-2 mb-3 grid gap-4 sm:grid-cols-2">
                    {inputField(t, i, 'via')}
                    {!showQuantity && inputField(t, i, 'quantity')}
                    {inputField(t, i, 'quantity_unit')}
                    {!showHours && inputField(t, i, 'hours')}
                    <Field
                      label="출발시각 (서울)"
                      hiddenPrefix={`${i + 1}회차 `}
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
                      label="도착시각 (서울)"
                      hiddenPrefix={`${i + 1}회차 `}
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
                      label="공차회차"
                      hiddenPrefix={`${i + 1}회차 `}
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
                      label="비고"
                      hiddenPrefix={`${i + 1}회차 `}
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
      <div className={`mt-4 grid gap-2 ${trips.length > 0 ? 'grid-cols-2' : ''}`}>
        <button type="button" className={button} onClick={() => addTrip()}>
          + 운행 추가
        </button>
        {trips.length > 0 && (
          <button type="button" className={button} onClick={() => addTrip(true)}>
            직전 회차 복사
          </button>
        )}
      </div>
    </Section>
  );
}
