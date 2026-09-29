'use client';
import { useContext, useEffect, useState } from 'react';
import Decimal from 'decimal.js';
import { api, ApiError } from '@/client/api';
import { cachedValue, cacheValue } from '@/client/offline/store';
import { units, chargeKinds, money, type RateResult, type UseDetail } from '@/client/types';
import {
  button,
  control,
  Field,
  Section,
  SettingsContext,
  FixContext,
  ValidationContext,
  HiddenFieldNotice,
} from './fields';
import { newCharge, tripQuantityPatch, type FormCharge, type FormValues } from './model';
function RateFields({
  charge,
  form,
  onChange,
  userId,
  saved,
}: {
  charge: FormCharge;
  form: FormValues;
  onChange: (patch: Partial<FormCharge>, automatic?: boolean) => void;
  userId: string;
  saved?: UseDetail;
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
        await cacheValue(userId, `rate:${query}`, data);
        if (alive) setResolved({ query, data });
      })
      .catch(async (error: unknown) => {
        if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
          if (alive) {
            setResolved(undefined);
            setError(error.message);
          }
          return;
        }
        const cached = await cachedValue<RateResult>(userId, `rate:${query}`);
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
  return (
    <div className="grid gap-4">
      <div className="rounded-xl bg-slate-50 p-4">
        <p className="font-bold">{rate?.name ?? '단가 미확정'}</p>
        <p className="mt-1 text-sm">
          {rate
            ? `${units[rate.billing_unit]} · 단가 ${money(rate.unit_price)}`
            : '계약 단가가 없거나 아직 조회되지 않았습니다.'}
        </p>
        <p className="mt-3 text-xl font-bold text-blue-800">
          {rate &&
          !charge.quantity &&
          ['PER_TRIP', 'PER_HOUR', 'PER_TON', 'PER_M3'].includes(rate.billing_unit)
            ? '청구 수량을 입력하세요'
            : `기본운임 ${money(estimate)}`}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {preserved ? '저장 당시 계약' : '예상 금액'} · 저장 시 서버 계산 결과 적용
        </p>
        {error && <p className="mt-2 text-sm text-amber-800">{error}</p>}
      </div>
      <Field label="과금 단위">
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
          <option value="">계약 자동 조회</option>
          {Object.entries(units).map(([v, n]) => (
            <option key={v} value={v}>
              {n}
            </option>
          ))}
        </select>
      </Field>
      <Field label="청구수량" target={`charge:${charge.id ?? charge.key}.quantity`}>
        <input
          className={control}
          inputMode="decimal"
          value={charge.quantity}
          onChange={(e) => onChange({ quantity: e.target.value, quantitySource: 'manual' })}
        />
      </Field>
      {charge.billing_unit === 'PER_TRIP' && (
        <>
          {charge.quantitySource === 'automatic' && (
            <p className="text-sm text-slate-600">
              운행 {form.trips.filter((trip) => trip.status === 'COMPLETED').length}회 기준 자동 입력, 수정
              가능
            </p>
          )}
          <button
            type="button"
            className={button}
            onClick={() =>
              onChange({
                quantity: String(form.trips.filter((t) => t.status === 'COMPLETED').length),
                quantitySource: 'manual',
              })
            }
          >
            완료 운행 {form.trips.filter((t) => t.status === 'COMPLETED').length}회 제안 적용
          </button>
        </>
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
}: {
  form: FormValues;
  mode: 'driver' | 'manager';
  onChange: (charges: FormCharge[], automatic?: boolean) => void;
  userId: string;
  saved?: UseDetail;
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
    <Section title={showExtra || hasExtra ? '과금·추가 비용' : '과금'} target="charges">
      {extraHidden && (hasExtra || hasExtraFix) && <HiddenFieldNotice />}
      <div className="grid gap-6">
        {visibleCharges.map((c, i) => (
          <div
            key={c.key}
            data-fix-target={`charge:${c.id ?? c.key}`}
            className="scroll-mt-6 rounded-xl border border-slate-200 p-4"
          >
            <Section
              title={`${c.direction === 'RECEIVABLE' ? '고객 청구' : '지급'} · ${chargeKinds[c.charge_type]}`}
              target={`charge:${c.id ?? c.key}`}
            >
              {c.charge_type === 'BASE' ? (
                <RateFields
                  charge={c}
                  form={form}
                  onChange={(change, automatic) => patch(c.key, change, automatic)}
                  userId={userId}
                  saved={saved}
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
                  <label className="flex items-center gap-3">
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
                  className={`${button} mt-4 text-red-700`}
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
