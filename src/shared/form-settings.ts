// Shared by the form and server submission checks. Billing and evidence are fixed rules.
export const fieldKeys = [
  'end_date',
  'work_type',
  'requester',
  'cargo_desc',
  'operation_status',
  'notes',
  'via',
  'cargo',
  'quantity',
  'quantity_unit',
  'hours',
  'depart_at',
  'arrive_at',
  'trip_status',
  'is_empty_return',
  'trip_notes',
  'extra_charges',
] as const;
export type FieldKey = (typeof fieldKeys)[number];
export const fieldModes = ['HIDDEN', 'OPTIONAL', 'REQUIRED'] as const;
export type FieldMode = (typeof fieldModes)[number];
export type FieldModes = Record<FieldKey, FieldMode>;
export const modeLabels: Record<FieldMode, string> = { HIDDEN: '숨김', OPTIONAL: '선택', REQUIRED: '필수' };
export const fieldLabels: Record<FieldKey, string> = {
  end_date: '종료일',
  work_type: '공종',
  requester: '요청자',
  cargo_desc: '운반 내용',
  operation_status: '전체 운행 상태',
  notes: '특이사항',
  via: '경유',
  cargo: '화물',
  quantity: '수량',
  quantity_unit: '수량 단위',
  hours: '시간',
  depart_at: '출발시각',
  arrive_at: '도착시각',
  trip_status: '운행 상태',
  is_empty_return: '공차회차',
  trip_notes: '비고',
  extra_charges: '추가 비용',
};
export function defaultFieldModes(role: 'driver' | 'manager'): FieldModes {
  return Object.fromEntries(
    fieldKeys.map((key) => [
      key,
      role === 'manager' || key === 'cargo_desc' || key === 'extra_charges' ? 'OPTIONAL' : 'HIDDEN',
    ]),
  ) as FieldModes;
}
export const tripFieldKeys: Partial<Record<string, FieldKey>> = {
  via: 'via',
  cargo_desc: 'cargo',
  quantity: 'quantity',
  quantity_unit: 'quantity_unit',
  hours: 'hours',
  depart_at: 'depart_at',
  arrive_at: 'arrive_at',
  status: 'trip_status',
  is_empty_return: 'is_empty_return',
  notes: 'trip_notes',
};
export function fieldKeyForTarget(target?: string): FieldKey | undefined {
  if (!target) return;
  if (target.startsWith('trip:')) return tripFieldKeys[target.split('.')[1]];
  const key = target.replace(/^use\./, '');
  if (key === 'work_type_id') return 'work_type';
  return fieldKeys.includes(key as FieldKey) ? (key as FieldKey) : undefined;
}
type FixCharge = { id: string; charge_type: string; direction: string };
export function fieldKeyForFixTarget(target: string, charges: FixCharge[]): FieldKey | undefined {
  if (target === 'charges') return 'extra_charges';
  if (target.startsWith('charge:')) {
    const line = charges.find((line) => line.id === target.slice(7).split('.')[0]);
    return line && !['BASE', 'ADJUSTMENT'].includes(line.charge_type) ? 'extra_charges' : undefined;
  }
  return fieldKeyForTarget(target);
}
export function fixTargetBlockedReason(target: string, modes: FieldModes, charges: FixCharge[]) {
  if (target.startsWith('charge:')) {
    const line = charges.find((line) => line.id === target.slice(7).split('.')[0]);
    if (line?.direction === 'RECEIVABLE' || line?.charge_type === 'ADJUSTMENT')
      return '기사가 수정할 수 없는 비용 항목은 보완요청할 수 없습니다.';
  }
  const key = fieldKeyForFixTarget(target, charges);
  if (key && modes[key] === 'HIDDEN')
    return `${fieldLabels[key]} 항목은 기사에게 숨김으로 설정되어 보완요청할 수 없습니다. 입력 항목 설정을 변경하세요.`;
}
export type FieldSetting = {
  field_key: FieldKey;
  driver_mode: FieldMode | null;
  manager_mode: FieldMode | null;
  version: number;
};
export type AdminFieldSettings = {
  project_id: string | null;
  fields: FieldSetting[];
  company: { driver: FieldModes; manager: FieldModes };
  effective: { driver: FieldModes; manager: FieldModes };
  pending_fixes: Partial<Record<FieldKey, number>>;
};
export type EffectiveFieldSettings = { project_id: string; modes: FieldModes; driver_modes?: FieldModes };

type Submission = {
  end_date?: unknown;
  work_type_id?: unknown;
  requester?: unknown;
  cargo_desc?: unknown;
  operation_status?: unknown;
  notes?: unknown;
  trips: { seq: number; origin?: unknown; destination?: unknown; [key: string]: unknown }[];
  charge_lines: { charge_type: string; direction?: string }[];
};
function empty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return !value.trim();
  if (Array.isArray(value)) return !value.some((item) => !empty(item));
  // false (공차 아님) and decimal zero are legitimate values.
  return false;
}
export function requiredFieldErrors(value: Submission, modes: FieldModes) {
  const fields: { target: string; reason: string }[] = [];
  const check = (key: FieldKey, item: unknown, target: string, prefix = '') => {
    if (modes[key] === 'REQUIRED' && empty(item))
      fields.push({ target, reason: `${prefix}${fieldLabels[key]} 항목을 입력하세요.` });
  };
  for (const key of [
    'end_date',
    'work_type',
    'requester',
    'cargo_desc',
    'operation_status',
    'notes',
  ] as const)
    check(key, value[key === 'work_type' ? 'work_type_id' : key], key === 'work_type' ? 'work_type_id' : key);
  if (!value.trips.length)
    fields.push({ target: 'trips', reason: '출발·도착을 입력한 운행을 1건 이상 추가하세요.' });
  for (const trip of value.trips) {
    if (empty(trip.origin) || empty(trip.destination))
      fields.push({ target: `trip:${trip.seq}.origin`, reason: `${trip.seq}회차 출발·도착을 입력하세요.` });
    for (const [property, key] of Object.entries(tripFieldKeys))
      if (key) check(key, trip[property], `trip:${trip.seq}.${property}`, `${trip.seq}회차 `);
  }
  check(
    'extra_charges',
    value.charge_lines.filter((line) => !['BASE', 'ADJUSTMENT'].includes(line.charge_type)),
    'charges',
  );
  return fields;
}
