import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { createUse, getUse, listUses, submitUse, approveUse } from '../../src/server/services/uses';
import { accessibleProjectIds } from '../../src/server/authz';
import { getLookups } from '../../src/server/services/lookups';
import { projectAssignments, vehicles } from '../../src/server/db/schema';
const database = testDatabase();
it('현장 담당자 배정·정산 담당자 전체 권한·기간 만료 배정', async () => {
  const s = await setupScenario(database().db);
  const manager = await s.f.user({ role: 'SITE_MANAGER', all_projects: true });
  const ctx = s.f.context(manager);
  const use = await createUse(s.adminCtx, s.input);
  await expect(getUse(ctx, use.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  const a = await s.f.assignment(manager.id, s.project.id);
  expect((await listUses(ctx)).total).toBe(1);
  await database()
    .db.update(projectAssignments)
    .set({ valid_to: '2020-12-31' })
    .where(eq(projectAssignments.id, a.id));
  await expect(getUse(ctx, use.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  const settlement = await s.f.user({ role: 'SETTLEMENT_MANAGER', all_projects: true });
  expect(await accessibleProjectIds(s.f.context(settlement))).toBeNull();
  expect((await getUse(s.f.context(settlement), use.id)).id).toBe(use.id);
});
it('비활성 기준정보는 선택 목록에서 제외되며 과거 내역은 조회 가능', async () => {
  const s = await setupScenario(database().db);
  const use = await createUse(s.driverCtx, s.input);
  await database().db.update(vehicles).set({ active: false }).where(eq(vehicles.id, s.vehicle.id));
  expect((await getLookups(s.driverCtx)).vehicles.some((v) => v.id === s.vehicle.id)).toBe(false);
  expect((await getUse(s.driverCtx, use.id)).snapshot.plate_no).toBe(s.vehicle.plate_no);
  await expect(createUse(s.driverCtx, s.input)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
});
it('DB 저장과 승인에 반올림·최소요금·세금 규칙 적용', async () => {
  const s = await setupScenario(database().db);
  for (const [rounding, computed] of [
    ['HALF_UP', 2],
    ['DOWN', 1],
    ['UP', 2],
  ] as const) {
    const party = await s.f.counterparty();
    await s.f.rate(party.id, { billing_unit: 'PER_HOUR', rounding, unit_price: 1 });
    const use = await createUse(s.adminCtx, {
      ...s.input,
      payee_counterparty_id: party.id,
      billing_unit: 'PER_HOUR',
      quantity: '1.5',
    });
    expect(use.charge_lines[0].computed_amount).toBe(computed);
  }
  for (const [tax_mode, supply, tax] of [
    ['VAT_EXCLUDED', 11000, 1100],
    ['VAT_INCLUDED', 10000, 1000],
    ['TAX_EXEMPT', 11000, 0],
  ] as const) {
    const party = await s.f.counterparty();
    await s.f.rate(party.id, { unit_price: 100, min_charge: 11000, tax_mode });
    let use = await createUse(s.adminCtx, { ...s.input, payee_counterparty_id: party.id });
    expect(use.charge_lines[0].computed_amount).toBe(11000);
    use = await submitUse(s.adminCtx, use.id, { version: use.version });
    use = await approveUse(s.adminCtx, use.id, { version: use.version });
    expect(use.charge_lines[0]).toMatchObject({ approved_amount: supply, tax_amount: tax });
  }
});
it('과금 단위 8종: 고정형 기본수량 1, 실적형은 입력 수량', async () => {
  const s = await setupScenario(database().db);
  for (const unit of [
    'PER_DAY',
    'HALF_DAY',
    'MONTHLY',
    'LUMP_SUM',
    'PER_TRIP',
    'PER_HOUR',
    'PER_TON',
    'PER_M3',
  ] as const) {
    const party = await s.f.counterparty();
    await s.f.rate(party.id, { billing_unit: unit, unit_price: 10000 });
    const fixed = ['PER_DAY', 'HALF_DAY', 'MONTHLY', 'LUMP_SUM'].includes(unit);
    const use = await createUse(s.adminCtx, {
      ...s.input,
      payee_counterparty_id: party.id,
      billing_unit: unit,
      quantity: fixed ? undefined : '2.5',
    });
    expect(use.charge_lines[0].computed_amount).toBe(fixed ? 10000 : 25000);
  }
});
