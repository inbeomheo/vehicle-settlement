import type { CreateUseInput } from '@/server/services/schemas';
import type { Lookups, Mode, UseDetail } from '@/client/types';
import { todaySeoul } from '@/client/types';

type TripInput = NonNullable<CreateUseInput['trips']>[number];
type ChargeInput = NonNullable<CreateUseInput['charge_lines']>[number];
export type FormTrip = Omit<TripInput, 'quantity' | 'hours' | 'depart_at' | 'arrive_at' | 'via'> & {
  quantity: string;
  hours: string;
  depart_at: string;
  arrive_at: string;
  via: string;
  client_row_id: string;
};
export type FormCharge = Omit<ChargeInput, 'requested_amount' | 'quantity' | 'billing_unit'> & {
  key: string;
  requested_amount: string;
  quantity: string;
  billing_unit: NonNullable<ChargeInput['billing_unit']> | '';
};
export type FormValues = {
  use_date: string;
  end_date: string;
  project_id: string;
  driver_id: string;
  vehicle_id: string;
  payee_counterparty_id: string;
  customer_counterparty_id: string;
  work_type_id: string;
  requester: string;
  cargo_desc: string;
  notes: string;
  operation_status: NonNullable<CreateUseInput['operation_status']>;
  trips: FormTrip[];
  charges: FormCharge[];
};
export function newTrip(): FormTrip {
  return {
    seq: 1,
    status: 'COMPLETED',
    origin: '',
    destination: '',
    via: '',
    depart_at: '',
    arrive_at: '',
    cargo_desc: '',
    quantity: '',
    quantity_unit: '',
    hours: '',
    is_empty_return: false,
    notes: '',
    client_row_id: crypto.randomUUID(),
  };
}
export function newCharge(direction: 'PAYABLE' | 'RECEIVABLE' = 'PAYABLE', base = true): FormCharge {
  return {
    key: crypto.randomUUID(),
    direction,
    charge_type: base ? 'BASE' : 'TOLL',
    billing_unit: '',
    quantity: '',
    requested_amount: '',
    reason: '',
    included_in_base: false,
  };
}
export function defaultPayee(lookups: Lookups, driver: string, date: string) {
  return (
    lookups.affiliations
      .filter((a) => a.driver_id === driver && a.valid_from <= date && (!a.valid_to || a.valid_to >= date))
      .sort((a, b) => b.valid_from.localeCompare(a.valid_from) || b.id.localeCompare(a.id))[0]
      ?.counterparty_id ?? ''
  );
}
export function initialValues(lookups: Lookups, project = ''): FormValues {
  const driver = lookups.drivers[0];
  const date = todaySeoul();
  return {
    use_date: date,
    end_date: '',
    project_id: project || lookups.projects[0]?.id || '',
    driver_id: driver?.id ?? '',
    vehicle_id: driver?.default_vehicle_id ?? lookups.vehicles[0]?.id ?? '',
    payee_counterparty_id: defaultPayee(lookups, driver?.id ?? '', date),
    customer_counterparty_id: '',
    work_type_id: '',
    requester: '',
    cargo_desc: '',
    notes: '',
    operation_status: 'COMPLETED',
    trips: [newTrip()],
    charges: [newCharge()],
  };
}
function localDateTime(value: string | null) {
  return value ? new Date(new Date(value).getTime() + 9 * 3600000).toISOString().slice(0, 16) : '';
}
export function fromUse(use: UseDetail, mode: Mode): FormValues {
  return {
    use_date: use.use_date,
    end_date: use.end_date ?? '',
    project_id: use.project_id,
    driver_id: use.driver_id,
    vehicle_id: use.vehicle_id,
    payee_counterparty_id: use.payee_counterparty_id,
    customer_counterparty_id: mode === 'manager' ? (use.customer_counterparty_id ?? '') : '',
    work_type_id: use.work_type_id ?? '',
    requester: use.requester ?? '',
    cargo_desc: use.cargo_desc ?? '',
    notes: use.notes ?? '',
    operation_status: use.operation_status,
    trips: use.trips.map((t) => ({
      id: t.id,
      seq: t.seq,
      status: t.status,
      origin: t.origin,
      destination: t.destination,
      via: t.via?.join(', ') ?? '',
      depart_at: localDateTime(t.depart_at),
      arrive_at: localDateTime(t.arrive_at),
      cargo_desc: t.cargo_desc,
      quantity: t.quantity ?? '',
      quantity_unit: t.quantity_unit,
      hours: t.hours ?? '',
      is_empty_return: t.is_empty_return,
      notes: t.notes,
      client_row_id: t.client_row_id ?? crypto.randomUUID(),
    })),
    charges: use.charge_lines
      .filter((c) => c.charge_type !== 'ADJUSTMENT' && (mode === 'manager' || c.direction === 'PAYABLE'))
      .map((c) => ({
        key: c.id,
        id: c.id,
        trip_id: c.trip_id,
        direction: c.direction,
        charge_type: c.charge_type as FormCharge['charge_type'],
        billing_unit: c.billing_unit,
        quantity: c.quantity ?? '',
        requested_amount: c.requested_amount?.toString() ?? '',
        reason: c.reason,
        included_in_base: c.included_in_base,
      })),
  };
}
export function toInput(form: FormValues, mode: Mode): CreateUseInput {
  return {
    use_date: form.use_date,
    end_date: form.end_date || null,
    project_id: form.project_id,
    driver_id: form.driver_id,
    vehicle_id: form.vehicle_id,
    ...(mode === 'manager'
      ? {
          payee_counterparty_id: form.payee_counterparty_id || undefined,
          customer_counterparty_id: form.customer_counterparty_id || null,
        }
      : {}),
    work_type_id: form.work_type_id || null,
    requester: form.requester,
    cargo_desc: form.cargo_desc,
    notes: form.notes,
    operation_status: form.operation_status,
    trips: form.trips.map((trip, i) => ({
      ...trip,
      seq: i + 1,
      via: trip.via
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
      depart_at: trip.depart_at ? `${trip.depart_at}:00+09:00` : null,
      arrive_at: trip.arrive_at ? `${trip.arrive_at}:00+09:00` : null,
      quantity: trip.quantity || null,
      hours: trip.hours || null,
    })),
    charge_lines: form.charges
      .filter((c) => mode === 'manager' || c.direction === 'PAYABLE')
      .map(({ key: _key, ...c }) => {
        void _key;
        return {
          ...c,
          billing_unit: c.billing_unit || undefined,
          quantity:
            c.quantity ||
            (['PER_DAY', 'HALF_DAY', 'MONTHLY', 'LUMP_SUM'].includes(c.billing_unit) ? '1' : undefined),
          requested_amount: c.charge_type === 'BASE' ? undefined : Number(c.requested_amount),
        };
      }),
  };
}
export function validate(form: FormValues, intent: 'save' | 'submit' = 'save') {
  const errors: string[] = [];
  if (!form.use_date || !form.project_id || !form.driver_id || !form.vehicle_id)
    errors.push('사용일·현장·기사·차량을 선택하세요.');
  if (form.end_date && form.end_date < form.use_date) errors.push('종료일은 사용일 이후여야 합니다.');
  form.trips.forEach((t, i) => {
    if (!t.origin.trim() || !t.destination.trim()) errors.push(`${i + 1}회차 출발·도착을 입력하세요.`);
    if (t.arrive_at && t.depart_at && t.arrive_at < t.depart_at)
      errors.push(`${i + 1}회차 도착시각을 확인하세요.`);
    if ([t.quantity, t.hours].some((v) => v && !/^\d{1,9}(\.\d{1,3})?$/.test(v)))
      errors.push(`${i + 1}회차 수량·시간은 소수 셋째 자리까지 입력하세요.`);
  });
  form.charges.forEach((c) => {
    if (
      intent === 'submit' &&
      c.charge_type === 'BASE' &&
      ['PER_TRIP', 'PER_HOUR', 'PER_TON', 'PER_M3'].includes(c.billing_unit) &&
      !c.quantity
    )
      errors.push('청구 수량을 입력하세요');
    if (c.quantity && !/^\d{1,9}(\.\d{1,3})?$/.test(c.quantity))
      errors.push('청구수량은 소수 셋째 자리까지 입력하세요.');
    if (
      c.charge_type !== 'BASE' &&
      (!/^\d+$/.test(c.requested_amount) || Number(c.requested_amount) > 2147483647 || !c.reason?.trim())
    )
      errors.push('추가 비용은 정수 원 요청액과 사유를 입력하세요.');
  });
  return errors;
}

// Copies contain only editable values, never server row IDs or review/statement links.
export function copyValues(use: UseDetail, mode: Mode): FormValues {
  const form = fromUse(use, mode);
  return {
    ...form,
    use_date: todaySeoul(),
    end_date: '',
    operation_status: 'COMPLETED',
    trips: form.trips.map((trip) => ({
      ...trip,
      id: undefined,
      client_row_id: crypto.randomUUID(),
      depart_at: '',
      arrive_at: '',
      status: 'COMPLETED',
    })),
    charges: form.charges.map((charge) => ({
      ...charge,
      id: undefined,
      trip_id: undefined,
      key: crypto.randomUUID(),
    })),
  };
}

export function resetBaseRates(charges: FormCharge[]) {
  return charges.map((charge) =>
    charge.charge_type === 'BASE' ? { ...charge, billing_unit: '' as const, quantity: '' } : charge,
  );
}
