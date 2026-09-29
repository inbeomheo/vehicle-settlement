import { expect, it } from 'vitest';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { approveUse, createUse, submitUse, updateUse } from '../../src/server/services/uses';

const database = testDatabase();

it.each(['header', 'charge_lines'] as const)(
  '현장 변경 시 %s에 명시한 회당 계약을 일대 계약보다 우선한다',
  async (source) => {
    const s = await setupScenario(database().db);
    const project = await s.f.project();
    const rate = await s.f.rate(s.payee.id, { billing_unit: 'PER_TRIP', unit_price: 100000 });
    await s.f.rate(s.payee.id, { project_id: project.id, unit_price: 400000 });
    const original = await createUse(s.adminCtx, { ...s.input, billing_unit: 'PER_TRIP', quantity: '2' });
    const charge = { billing_unit: 'PER_TRIP' as const, quantity: '3' };
    let use = await updateUse(s.adminCtx, original.id, {
      version: original.version,
      project_id: project.id,
      ...(source === 'header'
        ? charge
        : { charge_lines: [{ id: original.charge_lines[0].id, charge_type: 'BASE', ...charge }] }),
    });
    expect(use.charge_lines[0]).toMatchObject({
      billing_unit: 'PER_TRIP',
      rate_agreement_id: rate.id,
      quantity: '3.000',
      unit_price: 100000,
      computed_amount: 300000,
      agreement_snapshot: { billing_unit: 'PER_TRIP', unit_price: 100000 },
    });
    use = await submitUse(s.adminCtx, use.id, { version: use.version });
    use = await approveUse(s.adminCtx, use.id, { version: use.version });
    expect(use.charge_lines[0].approved_amount).toBe(300000);
  },
);

it.each(['PER_DAY', 'HALF_DAY', 'MONTHLY', 'LUMP_SUM'] as const)(
  '계약 변경 시 명시한 고정형 %s 수량 3을 저장·승인한다',
  async (billing_unit) => {
    const s = await setupScenario(database().db);
    await s.f.rate(s.payee.id, { billing_unit: 'PER_TRIP', unit_price: 100000 });
    const rate = await s.f.rate(s.payee.id, { billing_unit, unit_price: 300000 });
    const original = await createUse(s.adminCtx, { ...s.input, billing_unit: 'PER_TRIP', quantity: '2' });
    let use = await updateUse(s.adminCtx, original.id, {
      version: original.version,
      charge_lines: [{ id: original.charge_lines[0].id, charge_type: 'BASE', billing_unit, quantity: '3' }],
    });
    expect(use.charge_lines[0]).toMatchObject({
      billing_unit,
      rate_agreement_id: rate.id,
      quantity: '3.000',
      computed_amount: 900000,
    });
    use = await submitUse(s.adminCtx, use.id, { version: use.version });
    use = await approveUse(s.adminCtx, use.id, { version: use.version });
    expect(use.charge_lines[0].approved_amount).toBe(900000);
  },
);

it('현장 변경 시 단위 생략은 자동 선택하고 명시적 수량 0도 보존한다', async () => {
  const s = await setupScenario(database().db);
  const project = await s.f.project();
  const rate = await s.f.rate(s.payee.id, { project_id: project.id, unit_price: 400000 });
  const original = await createUse(s.adminCtx, { ...s.input, quantity: '5' });
  const use = await updateUse(s.adminCtx, original.id, {
    version: original.version,
    project_id: project.id,
    quantity: '0',
  });
  expect(use.charge_lines[0]).toMatchObject({
    rate_agreement_id: rate.id,
    billing_unit: 'PER_DAY',
    quantity: '0.000',
    computed_amount: 0,
  });
});

it.each(['PER_TRIP', 'PER_HOUR', 'PER_TON', 'PER_M3', 'PER_DAY', 'HALF_DAY', 'MONTHLY', 'LUMP_SUM'] as const)(
  '새 %s 계약에 수량을 생략하면 이전 5를 재사용하지 않고 단위별 기본값을 적용한다',
  async (billing_unit) => {
    const s = await setupScenario(database().db);
    const project = await s.f.project();
    const rate = await s.f.rate(s.payee.id, { project_id: project.id, billing_unit, unit_price: 123456 });
    const original = await createUse(s.adminCtx, { ...s.input, quantity: '5' });
    const use = await updateUse(s.adminCtx, original.id, {
      version: original.version,
      project_id: project.id,
    });
    const fixed = ['PER_DAY', 'HALF_DAY', 'MONTHLY', 'LUMP_SUM'].includes(billing_unit);
    expect(use.charge_lines[0]).toMatchObject({
      rate_agreement_id: rate.id,
      billing_unit,
      quantity: fixed ? '1.000' : null,
      computed_amount: fixed ? 123456 : null,
    });
    if (!fixed)
      await expect(submitUse(s.adminCtx, use.id, { version: use.version })).rejects.toMatchObject({
        code: 'SUBMIT_BLOCKED',
      });
  },
);

it('명시한 단위의 계약이 없으면 다른 단위 계약을 적용하지 않는다', async () => {
  const s = await setupScenario(database().db);
  const project = await s.f.project();
  await s.f.rate(s.payee.id, { project_id: project.id, unit_price: 400000 });
  const original = await createUse(s.adminCtx, { ...s.input, quantity: '5' });
  const use = await updateUse(s.adminCtx, original.id, {
    version: original.version,
    project_id: project.id,
    billing_unit: 'PER_TON',
    quantity: '3',
  });
  expect(use.charge_lines[0]).toMatchObject({
    billing_unit: 'PER_TON',
    quantity: '3.000',
    rate_agreement_id: null,
    unit_price: null,
    computed_amount: null,
    price_status: 'PENDING',
  });
});
