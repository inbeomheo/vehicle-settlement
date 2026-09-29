import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { billingUnitEnum } from '../db/schema';
import { AppError, invalid } from '../errors';
import { createUseSchema, quantity as quantitySchema, type CreateUseInput } from './schemas';
import type { ImportMapping } from './import-fields';

export type ImportSourceIds = Required<
  Pick<CreateUseInput, 'project_id' | 'driver_id' | 'vehicle_id' | 'payee_counterparty_id'>
>;
export const importIdentityLock = 'import:source-row';
const units: Record<string, (typeof billingUnitEnum.enumValues)[number]> = {
  회당: 'PER_TRIP',
  건당: 'PER_TRIP',
  일대: 'PER_DAY',
  반일: 'HALF_DAY',
  월대: 'MONTHLY',
  시간: 'PER_HOUR',
  톤: 'PER_TON',
  루베: 'PER_M3',
  '1식': 'LUMP_SUM',
  식: 'LUMP_SUM',
};

function money(value: string, label: string): number | null {
  if (!value) return null;
  if (!/^(\d+|\d{1,3}(,\d{3})+)(원)?$/.test(value)) invalid(`${label}: 0 이상의 정수 원을 입력하세요.`);
  const result = Number(value.replace(/[,원]/g, ''));
  if (!Number.isSafeInteger(result) || result > 2147483647) invalid(`${label}: 금액 범위를 초과했습니다.`);
  return result;
}
export function importDate(value: string) {
  const match = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  const result = match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : value;
  if (!z.iso.date().safeParse(result).success) invalid('사용일: YYYY-MM-DD 날짜를 입력하세요.');
  return result;
}

export function parseImportSource(
  values: string[],
  mapping: ImportMapping,
  ids: Partial<ImportSourceIds>,
  errors: string[] = [],
) {
  const get = (field: keyof ImportMapping) =>
    mapping[field] === undefined ? '' : (values[mapping[field]!] ?? '').trim().replace(/\r\n?/g, '\n');
  const collect = <T>(read: () => T): T | undefined => {
    try {
      return read();
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      errors.push(error.message);
      return undefined;
    }
  };
  const useDate = collect(() => importDate(get('use_date')));
  const rawUnit = get('billing_unit');
  const unit = units[rawUnit] ?? rawUnit;
  if (!billingUnitEnum.enumValues.includes(unit as (typeof billingUnitEnum.enumValues)[number]))
    errors.push('과금단위: 일대·회당·반일·월대·시간·톤·루베·1식을 지정하세요.');
  const billingUnit = unit as (typeof billingUnitEnum.enumValues)[number];
  const tripCount = Number(get('trips') || '1');
  if (!Number.isInteger(tripCount) || tripCount < 1 || tripCount > 500)
    errors.push('운행횟수: 1~500 정수를 입력하세요.');
  const quantity =
    get('quantity') || (['PER_DAY', 'HALF_DAY', 'MONTHLY', 'LUMP_SUM'].includes(unit) ? '1' : null);
  if (quantity !== null && !quantitySchema.safeParse(quantity).success)
    errors.push('청구수량: 0 이상, 소수 셋째 자리까지 입력하세요.');
  const importedPrice = collect(() => money(get('unit_price'), '단가'));
  const extra = collect(() => money(get('extra'), '추가비'));
  if (!ids.payee_counterparty_id) errors.push('지급처: 필수 항목입니다.');
  if (!get('origin')) errors.push('출발지: 필수 항목입니다.');
  if (!get('destination')) errors.push('도착지: 필수 항목입니다.');
  if (get('extra') && !get('reason')) errors.push('추가비 사유: 필수 항목입니다.');
  const parsed = createUseSchema.safeParse({
    use_date: useDate,
    project_id: ids.project_id,
    driver_id: ids.driver_id,
    vehicle_id: ids.vehicle_id,
    payee_counterparty_id: ids.payee_counterparty_id,
    cargo_desc: get('cargo_desc'),
    notes: get('notes'),
    billing_unit: billingUnit,
    quantity,
    trips: Array.from(
      { length: Number.isInteger(tripCount) && tripCount >= 1 && tripCount <= 500 ? tripCount : 1 },
      (_, i) => ({
        seq: i + 1,
        origin: get('origin'),
        destination: get('destination'),
        cargo_desc: get('cargo_desc'),
      }),
    ),
    charge_lines: [
      { charge_type: 'BASE', billing_unit: billingUnit, quantity },
      ...(extra !== null ? [{ charge_type: 'OTHER', requested_amount: extra, reason: get('reason') }] : []),
    ],
  });
  if (!parsed.success) {
    const labels: Record<string, string> = {
      use_date: '사용일',
      project_id: '현장',
      driver_id: '기사',
      vehicle_id: '차량번호',
      payee_counterparty_id: '지급처',
      cargo_desc: '운반내용',
      notes: '비고',
      billing_unit: '과금단위',
      quantity: '청구수량',
      origin: '출발지',
      destination: '도착지',
      reason: '추가비 사유',
      charge_lines: '비용',
      trips: '운행',
    };
    for (const issue of parsed.error.issues) {
      const field = issue.path.filter((part) => typeof part === 'string').at(-1) ?? '';
      const label = labels[String(field)] ?? '입력값';
      if (!errors.some((message) => message.startsWith(`${label}:`)))
        errors.push(`${label}: 입력 형식과 길이를 확인하세요.`);
    }
  }
  if (errors.length || !parsed.success) invalid('행의 입력값을 확인하세요.', errors);
  if (!useDate || importedPrice === undefined || extra === undefined)
    invalid('기준정보와 입력값을 확인하세요.');
  const input: CreateUseInput = parsed.data;
  const sourceIds: ImportSourceIds = {
    project_id: parsed.data.project_id,
    driver_id: parsed.data.driver_id,
    vehicle_id: parsed.data.vehicle_id,
    payee_counterparty_id: parsed.data.payee_counterparty_id!,
  };
  return {
    input,
    importedPrice,
    sourceIds,
    identity: {
      ...sourceIds,
      use_date: useDate,
      origin: get('origin'),
      destination: get('destination'),
      cargo_desc: get('cargo_desc'),
      trips: tripCount,
      billing_unit: billingUnit,
      quantity: quantity === null ? null : new Decimal(quantity).toString(),
      // Canonical source price text, including blank vs explicit zero. Never an applied rate.
      unit_price: importedPrice === null ? '' : String(importedPrice),
      extra: extra === null ? '' : String(extra),
      reason: get('reason'),
      notes: get('notes'),
    },
  };
}

export function importSourceHash(
  source: ReturnType<typeof parseImportSource>,
  occurrences: Map<string, number>,
) {
  const content = JSON.stringify(source.identity);
  const occurrence = (occurrences.get(content) ?? 0) + 1;
  occurrences.set(content, occurrence);
  return createHash('sha256')
    .update(JSON.stringify({ values: source.identity, occurrence }))
    .digest('hex');
}
