import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { chargeLines } from '../../src/server/db/schema';
import { approveUse, createUse, getUse, submitUse, updateUse } from '../../src/server/services/uses';
import { createStatement, confirmStatement } from '../../src/server/services/statements';
import { fromUse, resetBaseRates, toInput } from '../../src/components/use-form/model';
import type { UseDetail } from '../../src/client/types';

const database = testDatabase();
const json = (value: unknown): UseDetail => JSON.parse(JSON.stringify(value));

it.each(['PER_TRIP', 'PER_HOUR', 'PER_TON', 'PER_M3', 'PER_DAY', 'HALF_DAY', 'MONTHLY', 'LUMP_SUM'] as const)(
  '계약 변경 %s: 빈 수량을 이전 값으로 복원하지 않고 새 계약 단위로 저장·승인한다',
  async (billing_unit) => {
    const s = await setupScenario(database().db);
    const payee = await s.f.counterparty();
    const vehicle = await s.f.vehicle();
    const driver = await s.f.driver({ default_vehicle_id: vehicle.id });
    await s.f.affiliation(driver.id, payee.id);
    const rate = await s.f.rate(payee.id, { billing_unit, unit_price: 123456 });
    const original = await createUse(s.adminCtx, { ...s.input, quantity: '5' });
    const form = fromUse(json(original), 'manager');
    const payload = toInput(
      {
        ...form,
        driver_id: driver.id,
        vehicle_id: vehicle.id,
        payee_counterparty_id: payee.id,
        charges: resetBaseRates(form.charges),
      },
      'manager',
    );
    expect(payload.charge_lines![0].quantity).toBeNull();
    let use = await updateUse(s.adminCtx, original.id, { ...payload, version: original.version });
    const fixed = ['PER_DAY', 'HALF_DAY', 'MONTHLY', 'LUMP_SUM'].includes(billing_unit);
    expect(use.charge_lines[0]).toMatchObject({
      rate_agreement_id: rate.id,
      billing_unit,
      quantity: fixed ? '1.000' : null,
      computed_amount: fixed ? 123456 : null,
      agreement_snapshot: { billing_unit },
    });
    if (!fixed) {
      await expect(submitUse(s.adminCtx, use.id, { version: use.version })).rejects.toMatchObject({
        code: 'SUBMIT_BLOCKED',
      });
      use = await updateUse(s.adminCtx, use.id, { version: use.version, quantity: '2.5' });
    }
    use = await submitUse(s.adminCtx, use.id, { version: use.version });
    use = await approveUse(s.adminCtx, use.id, { version: use.version });
    expect(use.charge_lines[0].approved_amount).toBe(fixed ? 123456 : 308640);
  },
);

it.each(['omitted', 'stale-unit', 'explicit'] as const)(
  '직접 API 계약 변경 %s도 새 계약 규칙을 적용한다',
  async (kind) => {
    const s = await setupScenario(database().db);
    const vehicle = await s.f.vehicle({ vehicle_type: '덤프' });
    const rate = await s.f.rate(s.payee.id, {
      vehicle_type: '덤프',
      billing_unit: 'PER_TRIP',
      unit_price: 123456,
    });
    const original = await createUse(s.adminCtx, { ...s.input, quantity: '5' });
    const use = await updateUse(s.adminCtx, original.id, {
      version: original.version,
      vehicle_id: vehicle.id,
      ...(kind === 'omitted'
        ? {}
        : {
            charge_lines: [
              {
                id: original.charge_lines[0].id,
                charge_type: 'BASE' as const,
                billing_unit: 'PER_DAY' as const,
                ...(kind === 'explicit' ? { quantity: '2' } : {}),
              },
            ],
          }),
    });
    expect(use.charge_lines[0]).toMatchObject({
      rate_agreement_id: rate.id,
      billing_unit: 'PER_TRIP',
      quantity: kind === 'explicit' ? '2.000' : null,
      computed_amount: kind === 'explicit' ? 246912 : null,
    });
  },
);

it('동일 계약의 수량 생략은 보존하고 폼의 명시적 빈 수량은 지운다', async () => {
  const s = await setupScenario(database().db);
  await s.f.rate(s.payee.id, { project_id: s.project.id, billing_unit: 'PER_TRIP' });
  let use = await createUse(s.adminCtx, { ...s.input, billing_unit: 'PER_TRIP', quantity: '5' });
  use = await updateUse(s.adminCtx, use.id, { version: use.version, use_date: '2026-09-16' });
  expect(use.charge_lines[0].quantity).toBe('5.000');
  const form = fromUse(json(use), 'manager');
  form.charges[0].quantity = '';
  use = await updateUse(s.adminCtx, use.id, { ...toInput(form, 'manager'), version: use.version });
  expect(use.charge_lines[0].quantity).toBeNull();
});

it('기사는 숨겨진 청구 수량 없이 제출하고 담당자는 청구 수량 사유를 확인·보완한다', async () => {
  const s = await setupScenario(database().db);
  const customer = await s.f.counterparty({ kind: 'CUSTOMER' });
  await s.f.rate(customer.id, { direction: 'RECEIVABLE', billing_unit: 'PER_TRIP', unit_price: 200000 });
  let use = await createUse(s.adminCtx, {
    ...s.input,
    customer_counterparty_id: customer.id,
    charge_lines: [
      { direction: 'PAYABLE', charge_type: 'BASE' },
      { direction: 'RECEIVABLE', charge_type: 'BASE', billing_unit: 'PER_TRIP', quantity: null },
    ],
  });
  const hidden = use.charge_lines.find((line) => line.direction === 'RECEIVABLE')!;
  const submitted = await submitUse(s.driverCtx, use.id, { version: use.version });
  expect(submitted.review_status).toBe('SUBMITTED');
  expect(submitted.charge_lines.map((line) => line.direction)).toEqual(['PAYABLE']);
  await expect(
    approveUse(s.adminCtx, use.id, {
      version: submitted.version,
      lines: [{ id: hidden.id, line_review_status: 'APPROVED', approved_amount: 200000 }],
    }),
  ).rejects.toMatchObject({ message: expect.stringContaining('고객 청구 수량') });
  use = await getUse(s.adminCtx, use.id);
  use = await updateUse(s.adminCtx, use.id, {
    version: use.version,
    charge_lines: use.charge_lines.map((line) => ({
      id: line.id,
      direction: line.direction,
      charge_type: 'BASE',
      billing_unit: line.billing_unit,
      quantity: '1',
    })),
  });
  expect(use.review_status).toBe('SUBMITTED');
  use = await approveUse(s.adminCtx, use.id, { version: use.version });
  expect(use.charge_lines.find((line) => line.id === hidden.id)?.approved_amount).toBe(200000);
});

it('기존 승인 자료도 청구 수량이 없으면 정산 확정에서 담당자에게 사유를 표시한다', async () => {
  const s = await setupScenario(database().db);
  const customer = await s.f.counterparty({ kind: 'CUSTOMER' });
  await s.f.rate(customer.id, { direction: 'RECEIVABLE', billing_unit: 'PER_TRIP' });
  let use = await createUse(s.adminCtx, {
    ...s.input,
    customer_counterparty_id: customer.id,
    charge_lines: [
      { direction: 'PAYABLE', charge_type: 'BASE' },
      { direction: 'RECEIVABLE', charge_type: 'BASE', billing_unit: 'PER_TRIP', quantity: '1' },
    ],
  });
  use = await submitUse(s.adminCtx, use.id, { version: use.version });
  use = await approveUse(s.adminCtx, use.id, { version: use.version });
  const line = use.charge_lines.find((line) => line.direction === 'RECEIVABLE')!;
  // Simulate a legacy approval which supplied an amount despite missing quantity.
  await database().db.update(chargeLines).set({ quantity: null }).where(eq(chargeLines.id, line.id));
  const statement = await createStatement(s.adminCtx, {
    client_request_id: crypto.randomUUID(),
    direction: 'RECEIVABLE',
    counterparty_id: customer.id,
    period_start: '2026-09-01',
    period_end: '2026-09-30',
    items: [{ charge_line_id: line.id }],
  });
  expect(statement.items[0].reasons).toContain('고객 청구 수량을 입력하세요');
  await expect(
    confirmStatement(s.adminCtx, statement.id, {
      version: statement.version,
      confirmation_token: statement.confirmation_token!,
    }),
  ).rejects.toMatchObject({
    code: 'CONFIRM_BLOCKED',
    details: expect.arrayContaining([
      expect.objectContaining({ chargeLineId: line.id, reason: '고객 청구 수량을 입력하세요' }),
    ]),
  });
});

it('구버전에서 개별 승인한 청구 라인도 전체 승인 시 수량을 검사하며 보류 후 지급 정산은 가능하다', async () => {
  const s = await setupScenario(database().db);
  const customer = await s.f.counterparty({ kind: 'CUSTOMER' });
  await s.f.rate(customer.id, { direction: 'RECEIVABLE', billing_unit: 'PER_TRIP' });
  let use = await createUse(s.adminCtx, {
    ...s.input,
    customer_counterparty_id: customer.id,
    charge_lines: [
      { direction: 'PAYABLE', charge_type: 'BASE' },
      { direction: 'RECEIVABLE', charge_type: 'BASE', billing_unit: 'PER_TRIP', quantity: '1' },
    ],
  });
  use = await submitUse(s.adminCtx, use.id, { version: use.version });
  const line = use.charge_lines.find((line) => line.direction === 'RECEIVABLE')!;
  await database()
    .db.update(chargeLines)
    .set({ quantity: null, line_review_status: 'APPROVED', approved_amount: 300000, tax_amount: 30000 })
    .where(eq(chargeLines.id, line.id));
  await expect(approveUse(s.adminCtx, use.id, { version: use.version })).rejects.toMatchObject({
    message: '고객 청구 수량을 입력하세요',
  });
  use = await approveUse(s.adminCtx, use.id, {
    version: use.version,
    lines: [{ id: line.id, line_review_status: 'HELD', reason: '고객 청구 수량 확인 중' }],
  });
  const payable = use.charge_lines.find((line) => line.direction === 'PAYABLE')!;
  const statement = await createStatement(s.adminCtx, {
    client_request_id: crypto.randomUUID(),
    direction: 'PAYABLE',
    counterparty_id: s.payee.id,
    period_start: '2026-09-01',
    period_end: '2026-09-30',
    items: [{ charge_line_id: payable.id }],
  });
  const confirmed = await confirmStatement(s.adminCtx, statement.id, {
    version: statement.version,
    confirmation_token: statement.confirmation_token!,
  });
  expect(confirmed.status).toBe('CONFIRMED');
  expect(confirmed.supply_total).toBe(300000);
});
