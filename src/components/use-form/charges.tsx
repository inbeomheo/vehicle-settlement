'use client';
import { useContext, useEffect, useState } from 'react';
import Decimal from 'decimal.js';
import { api, ApiError } from '@/client/api';
import { errorMessage } from '@/client/error-message';
import { cachedValue, cacheValue } from '@/client/offline/store';
import { units, chargeKinds, money, type RateResult, type UseDetail } from '@/client/types';
import { button, control, Field, Section, SettingsContext, FixContext, ValidationContext } from './fields';
import { newCharge, tripQuantityPatch, type FormCharge, type FormValues } from './model';
function RateFields({
  charge,
  form,
  onChange,
  userId,
  saved,
  onEstimate,
}: {
  charge: FormCharge;
  form: FormValues;
  onChange: (patch: Partial<FormCharge>, automatic?: boolean) => void;
  userId: string;
  saved?: UseDetail;
  onEstimate?: (value: number | null) => void;
}) {
  const [resolved, setResolved] = useState<{ query: string; data: RateResult }>();
  const [error, setError] = useState('');
  const party =
    charge.direction === 'RECEIVABLE' ? form.customer_counterparty_id : form.payee_counterparty_id;
  const query = new URLSearchParams({
    project_id: form.project_id,
    counterparty_id: party,
    vehicle_id: form.vehicle_id,
    use_date: form.use_date,
    direction: charge.direction ?? 'PAYABLE',
    ...(charge.billing_unit ? { billing_unit: charge.billing_unit } : {}),
  }).toString();
  const result = resolved?.query === query ? resolved.data : undefined;
  const previous = saved?.charge_lines.find((c) => c.id === charge.id);
  const preserved =
    previous?.rate_agreement_id &&
    saved?.use_date === form.use_date &&
    saved?.project_id === form.project_id &&
    saved?.vehicle_id === form.vehicle_id &&
    saved?.driver_id === form.driver_id &&
    previous.counterparty_id === party &&
    previous.billing_unit === charge.billing_unit;
  useEffect(() => {
    let alive = true;
    setResolved(undefined);
    setError('');
    if (!party || !form.project_id || !form.vehicle_id || !form.use_date || preserved) return;
    void api<RateResult>(`/api/rates/lookup?${query}`)
      .then(async (data) => {
        await cacheValue(userId, `rate:${query}`, data).catch(() => {});
        if (alive) setResolved({ query, data });
      })
      .catch(async (error: unknown) => {
        if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
          if (alive) {
            setResolved(undefined);
            setError(errorMessage(error, '계약을 확인할 수 없습니다. 다시 시도해 주세요.'));
          }
          return;
        }
        const cached = await cachedValue<RateResult>(userId, `rate:${query}`).catch(() => undefined);
        if (alive) {
          setResolved(cached ? { query, data: cached } : undefined);
          setError(
            cached
              ? '오프라인: 마지막으로 확인한 계약입니다. 저장 시 다시 확인합니다.'
              : '계약을 확인할 수 없습니다. 연결 후 서버에서 확정합니다.',
          );
        }
      });
    return () => {
      alive = false;
    };
  }, [query, userId, party, form.project_id, form.vehicle_id, form.use_date, preserved]);
  const rate = preserved ? (previous?.agreement_snapshot as RateResult['rate']) : result?.rate;
  useEffect(() => {
    if (result?.rate && !charge.billing_unit)
      onChange(
        {
          billing_unit: result.rate.billing_unit,
          ...(!charge.quantity &&
          ['PER_DAY', 'HALF_DAY', 'MONTHLY', 'LUMP_SUM'].includes(result.rate.billing_unit)
            ? { quantity: '1', quantitySource: 'automatic' }
            : {}),
        },
        true,
      );
  }, [result, charge.billing_unit, charge.quantity, onChange]);
  useEffect(() => {
    const patch = tripQuantityPatch(charge, form.trips);
    if (patch) onChange(patch, true);
  }, [charge, form.trips, onChange]);
  let estimate: number | null = null;
  if (rate && /^\d{1,9}(\.\d{1,3})?$/.test(charge.quantity)) {
    const rounding = { HALF_UP: Decimal.ROUND_HALF_UP, DOWN: Decimal.ROUND_DOWN, UP: Decimal.ROUND_UP }[
      rate.rounding
    ];
    estimate = Decimal.max(
      new Decimal(charge.quantity).mul(rate.unit_price).toDecimalPlaces(0, rounding),
      rate.min_charge ?? 0,
    ).toNumber();
  }
  useEffect(() => {
    onEstimate?.(estimate);
  }, [estimate, onEstimate]);
  const needsQuantity =
    !!rate && !charge.quantity && ['PER_TRIP', 'PER_HOUR', 'PER_TON', 'PER_M3'].includes(rate.billing_unit);
  const completedTrips = form.trips.filter((t) => t.status === 'COMPLETED').length;
  return (
    <div className="grid gap-4">
      <div aria-live="polite" aria-atomic="true" className="grid gap-2">
        <div className="flex min-w-0 flex-wrap overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
          <div className="min-w-[min(100%,11rem)] flex-[2_1_11rem] p-4">
            <p className="flex flex-wrap items-center gap-1.5 text-sm text-slate-700">
              <span className="truncate">{rate?.name ?? '단가 미확정'}</span>
              {rate && (
                <span className="shrink-0 whitespace-nowrap rounded bg-slate-200 px-1.5 py-0.5 text-sm font-semibold text-slate-800">
                  {preserved ? '저장 당시 계약' : '자동 적용'}
                </span>
              )}
            </p>
            <p className="mt-1 text-2xl font-bold whitespace-nowrap">
              {rate ? units[rate.billing_unit] : '—'}
            </p>
            <p className="mt-0.5 text-sm text-slate-700">
              {rate ? `단가 ${money(rate.unit_price)}` : '단가를 아직 찾지 못했습니다. 담당자가 확인합니다.'}
            </p>
          </div>
          <div aria-hidden="true" className="slip-perforation w-2 shrink-0" />
          <div className="flex min-w-[min(100%,9rem)] flex-[1_1_9rem] flex-col items-end justify-center p-4 text-right">
            {needsQuantity ? (
              <p className="text-[0.9375rem] font-bold text-orange-700">청구 수량을 입력하세요</p>
            ) : (
              <p className="leading-tight">
                <span className="block text-sm text-slate-700">기본운임</span>{' '}
                <span className="num text-[1.625rem] font-bold whitespace-nowrap">{money(estimate)}</span>
              </p>
            )}
          </div>
        </div>
        {error && <p className="text-[0.9375rem] font-semibold text-orange-800">{error}</p>}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-3">
        <Field label="요금 기준">
          <select
            className={control}
            value={charge.billing_unit}
            onChange={(e) => {
              const unit = e.target.value as FormCharge['billing_unit'];
              onChange({
                billing_unit: unit,
                ...(!charge.quantity && ['PER_DAY', 'HALF_DAY', 'MONTHLY', 'LUMP_SUM'].includes(unit)
                  ? { quantity: '1', quantitySource: 'automatic' }
                  : {}),
              });
            }}
          >
            <option value="">계약에서 자동</option>
            {Object.entries(units).map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <Field label="청구 수량" target={`charge:${charge.id ?? charge.key}.quantity`}>
          <input
            className={control}
            inputMode="decimal"
            value={charge.quantity}
            onChange={(e) => onChange({ quantity: e.target.value, quantitySource: 'manual' })}
          />
        </Field>
      </div>
      {charge.billing_unit === 'PER_TRIP' && (
        <div className="flex flex-wrap items-center gap-2">
          {charge.quantitySource === 'automatic' && (
            <p className="text-[0.9375rem] text-slate-700">
              운행 {completedTrips}회로 자동 입력했습니다. 고칠 수 있습니다.
            </p>
          )}
          <button
            type="button"
            className={button}
            onClick={() =>
              onChange({
                quantity: String(completedTrips),
                quantitySource: 'manual',
              })
            }
          >
            완료 운행 {completedTrips}회 제안 적용
          </button>
        </div>
      )}
    </div>
  );
}
export function ChargeFields({
  form,
  mode,
  onChange,
  userId,
  saved,
  step,
  done,
  onEstimate,
}: {
  form: FormValues;
  mode: 'driver' | 'manager';
  onChange: (charges: FormCharge[], automatic?: boolean) => void;
  userId: string;
  saved?: UseDetail;
  step?: number;
  done?: boolean;
  onEstimate?: (key: string, value: number | null) => void;
}) {
  const settings = useContext(SettingsContext);
  const fixes = useContext(FixContext);
  const errors = useContext(ValidationContext);
  const visibleCharges = form.charges.filter((c) => mode === 'manager' || c.direction === 'PAYABLE');
  const hasExtraFix = fixes.some(
    (fix) =>
      ['charges', 'extra_charges'].includes(fix.target) ||
      (fix.target.startsWith('charge:') &&
        !visibleCharges.some(
          (line) => line.id === fix.target.slice(7).split('.')[0] && line.charge_type === 'BASE',
        )),
  );
  const extraHidden = settings.extra_charges === 'HIDDEN';
  const showExtra = !extraHidden || hasExtraFix || errors.some((error) => error.target === 'charges');
  const hasExtra = visibleCharges.some((c) => c.charge_type !== 'BASE');
  const patch = (key: string, change: Partial<FormCharge>, automatic = false) =>
    onChange(
      form.charges.map((c) => (c.key === key ? { ...c, ...change } : c)),
      automatic,
    );
  return (
    <Section
      title={mode === 'driver' ? '요금 확인' : showExtra || hasExtra ? '요금·추가 비용' : '요금'}
      target="charges"
      step={step}
      done={done}
    >
      <div className="grid gap-5">
        {visibleCharges.map((c, i) => (
          <div
            key={c.key}
            data-fix-target={`charge:${c.id ?? c.key}`}
            className={`scroll-mt-24 ${c.charge_type === 'BASE' ? '' : 'rounded-lg border border-slate-200 p-3'}`}
          >
            <Section
              plain
              hideTitle={mode === 'driver' && c.charge_type === 'BASE'}
              title={
                mode === 'driver' && c.charge_type === 'BASE'
                  ? '기본운임'
                  : `${c.direction === 'RECEIVABLE' ? '고객 청구' : '지급'} · ${chargeKinds[c.charge_type]}`
              }
              target={`charge:${c.id ?? c.key}`}
            >
              {c.charge_type === 'BASE' ? (
                <RateFields
                  charge={c}
                  form={form}
                  onChange={(change, automatic) => patch(c.key, change, automatic)}
                  userId={userId}
                  saved={saved}
                  onEstimate={onEstimate ? (value) => onEstimate(c.key, value) : undefined}
                />
              ) : (
                <div className="grid gap-4">
                  <Field label={`추가비 ${i} 종류`}>
                    <select
                      className={control}
                      value={c.charge_type}
                      disabled={!!c.id}
                      onChange={(e) =>
                        patch(c.key, { charge_type: e.target.value as FormCharge['charge_type'] })
                      }
                    >
                      {Object.entries(chargeKinds)
                        .filter(([v]) => v !== 'BASE')
                        .map(([v, n]) => (
                          <option key={v} value={v}>
                            {n}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field
                    label={`추가비 ${i} 요청액 (원)`}
                    target={`charge:${c.id ?? c.key}.requested_amount`}
                  >
                    <input
                      className={control}
                      inputMode="numeric"
                      value={c.requested_amount}
                      onChange={(e) => patch(c.key, { requested_amount: e.target.value })}
                    />
                  </Field>
                  <Field label={`추가비 ${i} 사유`} target={`charge:${c.id ?? c.key}.reason`}>
                    <input
                      className={control}
                      value={c.reason ?? ''}
                      onChange={(e) => patch(c.key, { reason: e.target.value })}
                    />
                  </Field>
                  <label className="flex min-h-11 items-center gap-3 text-[0.9375rem]">
                    <input
                      className="h-11 w-11 shrink-0 text-base"
                      type="checkbox"
                      checked={c.included_in_base}
                      onChange={(e) => patch(c.key, { included_in_base: e.target.checked })}
                    />
                    기본운임에 포함 (0원)
                  </label>
                </div>
              )}
              {c.charge_type !== 'BASE' && (
                <button
                  type="button"
                  className="mt-3 min-h-11 rounded-lg px-3 text-sm font-semibold text-red-700 hover:bg-red-50"
                  onClick={() => onChange(form.charges.filter((row) => row.key !== c.key))}
                >
                  추가 비용 삭제
                </button>
              )}
            </Section>
          </div>
        ))}
      </div>
      {showExtra && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className={button}
            onClick={() => onChange([...form.charges, newCharge('PAYABLE', false)])}
          >
            + 추가 비용{settings.extra_charges === 'REQUIRED' ? ' (필수)' : ''}
          </button>
          {mode === 'manager' && form.customer_counterparty_id && (
            <button
              type="button"
              className={button}
              onClick={() => onChange([...form.charges, newCharge('RECEIVABLE', false)])}
            >
              + 고객 청구 추가비
            </button>
          )}
        </div>
      )}
    </Section>
  );
}
