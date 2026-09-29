import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import {
  createUse,
  getUse,
  updateUse,
  submitUse,
  approveUse,
  listUses,
} from '../../src/server/services/uses';
import { lookupRate } from '../../src/server/services/rates';
import {
  drivers,
  vehicles,
  counterparties,
  driverAffiliations,
  rateAgreements,
} from '../../src/server/db/schema';
const database = testDatabase();
const tripRows = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    seq: i + 1,
    origin: '서울',
    destination: '인천',
    client_row_id: `trip-${i}`,
  }));
describe('사용 건과 과금', () => {
  it('(a,c) 일대 30만원은 운행 5건이어도 BASE 한 줄, 반복 경로 보존', async () => {
    const s = await setupScenario(database().db);
    const use = await createUse(s.driverCtx, { ...s.input, trips: tripRows(5) });
    expect(use.trips).toHaveLength(5);
    expect(use.charge_lines).toHaveLength(1);
    expect(use.charge_lines[0]).toMatchObject({
      quantity: '1.000',
      computed_amount: 300000,
      price_status: 'CONFIRMED',
    });
    expect(use.duplicate_hint).toBe(true);
    expect(use.entered_as).toBe('DRIVER_SELF');
    const second = await createUse(s.driverCtx, { ...s.input, trips: tripRows(2) });
    expect(second.id).not.toBe(use.id);
    expect(second.trips).toHaveLength(2);
  });
  it('(b) 회당 청구수량 5, 실적 3건은 50만원; 실적은 제안일 뿐', async () => {
    const s = await setupScenario(database().db);
    await s.f.rate(s.payee.id, { billing_unit: 'PER_TRIP', unit_price: 100000 });
    const result = await lookupRate(s.driverCtx, {
      ...s.input,
      counterparty_id: s.payee.id,
      billing_unit: 'PER_TRIP',
      completed_trips: 3,
    });
    expect(result.suggested_quantity).toBe('3');
    const use = await createUse(s.driverCtx, {
      ...s.input,
      billing_unit: 'PER_TRIP',
      quantity: '5',
      trips: tripRows(3),
    });
    expect(use.charge_lines[0].computed_amount).toBe(500000);
    const pending = await createUse(s.driverCtx, {
      ...s.input,
      billing_unit: 'PER_TRIP',
      trips: tripRows(3),
    });
    expect(pending.charge_lines[0]).toMatchObject({
      quantity: null,
      computed_amount: null,
      price_status: 'PENDING',
    });
  });
  it('(d) 동시 client_request_id 생성은 하나만 저장', async () => {
    const s = await setupScenario(database().db);
    const input = { ...s.input, client_request_id: crypto.randomUUID(), trips: tripRows(2) };
    const [a, b] = await Promise.all([createUse(s.driverCtx, input), createUse(s.driverCtx, input)]);
    expect(a.id).toBe(b.id);
    expect(b.trips).toHaveLength(2);
    expect((await listUses(s.driverCtx)).total).toBe(1);
  });
  it('(e) 기사·차량·소속 정보 변경 후에도 기존 스냅샷 유지', async () => {
    const s = await setupScenario(database().db);
    const use = await createUse(s.driverCtx, s.input);
    await database().db.update(drivers).set({ name: '바뀐 이름' }).where(eq(drivers.id, s.driver.id));
    await database()
      .db.update(vehicles)
      .set({ plate_no: `변경-${crypto.randomUUID()}` })
      .where(eq(vehicles.id, s.vehicle.id));
    await database()
      .db.update(counterparties)
      .set({ name: '바뀐 운송사' })
      .where(eq(counterparties.id, s.payee.id));
    const other = await s.f.counterparty();
    await database()
      .db.update(driverAffiliations)
      .set({ counterparty_id: other.id })
      .where(eq(driverAffiliations.id, s.affiliation.id));
    expect((await getUse(s.driverCtx, use.id)).snapshot).toEqual(use.snapshot);
    const edited = await updateUse(s.adminCtx, use.id, { version: use.version, notes: '메모 변경' });
    expect(edited.snapshot.driver_name).toBe('바뀐 이름');
  });
  it('(f) 새 기간 단가는 새 건에만 적용, 참조 계약 직접 수정 차단', async () => {
    const s = await setupScenario(database().db);
    let use = await createUse(s.adminCtx, s.input);
    use = await submitUse(s.adminCtx, use.id, { version: use.version });
    use = await approveUse(s.adminCtx, use.id, { version: use.version });
    await expect(
      database()
        .db.update(rateAgreements)
        .set({ unit_price: 400000 })
        .where(eq(rateAgreements.id, s.rate.id)),
    ).rejects.toThrow();
    await database()
      .db.update(rateAgreements)
      .set({ valid_to: '2026-09-30' })
      .where(eq(rateAgreements.id, s.rate.id));
    await s.f.rate(s.payee.id, { unit_price: 400000, valid_from: '2026-10-01' });
    const fresh = await createUse(s.adminCtx, { ...s.input, use_date: '2026-10-03' });
    expect(fresh.charge_lines[0].computed_amount).toBe(400000);
    expect((await getUse(s.adminCtx, use.id)).charge_lines[0].approved_amount).toBe(300000);
  });
  it('(k) 동시 version 수정 중 한 건만 성공', async () => {
    const s = await setupScenario(database().db);
    const use = await createUse(s.adminCtx, s.input);
    const results = await Promise.allSettled([
      updateUse(s.adminCtx, use.id, { version: use.version, notes: 'A' }),
      updateUse(s.adminCtx, use.id, { version: use.version, notes: 'B' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason.code).toBe('VERSION_CONFLICT');
  });
  it('(l) 단가 미확정 null과 0원 단가는 구분', async () => {
    const s = await setupScenario(database().db);
    const p = await createUse(s.adminCtx, { ...s.input, billing_unit: 'PER_HOUR', quantity: '2' });
    expect(p.charge_lines[0]).toMatchObject({
      price_status: 'PENDING',
      computed_amount: null,
      unit_price: null,
    });
    await s.f.rate(s.payee.id, { billing_unit: 'PER_HOUR', unit_price: 0 });
    let zero = await createUse(s.adminCtx, { ...s.input, billing_unit: 'PER_HOUR', quantity: '2' });
    zero = await submitUse(s.adminCtx, zero.id, { version: zero.version });
    zero = await approveUse(s.adminCtx, zero.id, { version: zero.version });
    expect(zero.charge_lines[0]).toMatchObject({
      price_status: 'CONFIRMED',
      computed_amount: 0,
      approved_amount: 0,
    });
  });
  it('서버 금액 조작 거부 및 음수 요청액 거부', async () => {
    const s = await setupScenario(database().db);
    await expect(
      createUse(s.driverCtx, {
        ...s.input,
        charge_lines: [{ charge_type: 'BASE', computed_amount: 1 }],
      } as never),
    ).rejects.toThrow();
    await expect(
      createUse(s.driverCtx, {
        ...s.input,
        charge_lines: [{ charge_type: 'TOLL', requested_amount: -100, reason: '조작' }],
      }),
    ).rejects.toThrow();
  });
  it('구체 단가와 페이지 합계/전체 합계', async () => {
    const s = await setupScenario(database().db);
    await s.f.rate(s.payee.id, { project_id: s.project.id, unit_price: 330000 });
    for (let i = 0; i < 2; i++) {
      let u = await createUse(s.driverCtx, s.input);
      expect(u.charge_lines[0].computed_amount).toBe(330000);
      u = await submitUse(s.driverCtx, u.id, { version: u.version });
      await approveUse(s.adminCtx, u.id, { version: u.version });
    }
    const result = await listUses(s.driverCtx, { pageSize: 1 });
    expect(result).toMatchObject({ total: 2, totals: { pageSum: 330000, filteredSum: 660000 } });
  });
});
it('기사가 사용일을 바꿔도 숨겨진 청구 비용은 서버에서 계산하고 응답에서 제거', async () => {
  const s = await setupScenario(database().db);
  const customer = await s.f.counterparty({ kind: 'CUSTOMER' });
  await s.f.rate(customer.id, { direction: 'RECEIVABLE', unit_price: 350000, valid_to: '2026-09-30' });
  await s.f.rate(customer.id, { direction: 'RECEIVABLE', unit_price: 370000, valid_from: '2026-10-01' });
  const use = await createUse(s.adminCtx, { ...s.input, customer_counterparty_id: customer.id });
  const changed = await updateUse(s.driverCtx, use.id, {
    version: use.version,
    use_date: '2026-10-01',
    quantity: '2',
  });
  expect(changed.charge_lines).toHaveLength(1);
  expect(changed.charge_lines[0].computed_amount).toBe(600000);
  const manager = await getUse(s.adminCtx, use.id);
  expect(manager.charge_lines.find((c) => c.direction === 'RECEIVABLE')).toMatchObject({
    computed_amount: 370000,
    quantity: '1.000',
  });
});
