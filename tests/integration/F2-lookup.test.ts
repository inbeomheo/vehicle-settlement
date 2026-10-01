import { expect, it } from 'vitest';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { getLookups } from '../../src/server/services/lookups';
import { createUse } from '../../src/server/services/uses';
import { withDatabase } from '../../src/server/db/client';
import { GET as options } from '../../src/app/api/ledger/options/route';
import type { RouteHandler } from '../../src/server/http';

const database = testDatabase();
async function request(handler: RouteHandler, token: string, path: string, params = {}) {
  return withDatabase(database().db, () =>
    handler(
      new Request(`http://localhost:3181${path}`, {
        headers: { cookie: `sid=${token}` },
      }),
      { params: Promise.resolve(params) },
    ),
  );
}

it('계정·현장 이력 없는 활성 기사·차량·기사 지급처를 선택하고 대리 저장한다', async () => {
  const s = await setupScenario(database().db);
  const manager = await s.f.user({ role: 'SITE_MANAGER' });
  await s.f.assignment(manager.id, s.project.id);
  const ctx = s.f.context(manager);
  const driver = await s.f.driver();
  const vehicle = await s.f.vehicle();
  const payee = await s.f.counterparty({
    kind: 'DRIVER_BUSINESS',
    phone: '01055556666',
    biz_no: '1234567890',
    bank_account: 'SECRET',
  });
  const inactive = await s.f.driver({ active: false });
  const unrelated = await s.f.counterparty({ kind: 'CUSTOMER' });
  const data = await getLookups(ctx);
  expect(data.drivers.map((r) => r.id)).toContain(driver.id);
  expect(data.vehicles.map((r) => r.id)).toContain(vehicle.id);
  expect(data.counterparties.map((r) => r.id)).toContain(payee.id);
  expect(data.drivers.map((r) => r.id)).not.toContain(inactive.id);
  expect(data.counterparties.map((r) => r.id)).not.toContain(unrelated.id);
  expect(JSON.stringify(data)).not.toMatch(/"(phone|biz_no|bank_account|contact_name)":/);
  const input = { ...s.input, driver_id: driver.id, vehicle_id: vehicle.id, payee_counterparty_id: payee.id };
  expect(await createUse(ctx, input)).toMatchObject({ entered_as: 'PROXY', driver_id: driver.id });
  await expect(createUse(ctx, { ...input, customer_counterparty_id: unrelated.id })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  const outside = await s.f.project();
  await expect(createUse(ctx, { ...input, project_id: outside.id })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  const self = await getLookups(s.driverCtx);
  expect(self.drivers.map((r) => r.id)).toEqual([s.driver.id]);
  expect(self.vehicles.map((r) => r.id)).toEqual([s.vehicle.id]);
});

it('사용대장 선택지는 현장 담당자에게 200이며 모든 역할에서 민감 필드를 제외한다', async () => {
  const s = await setupScenario(database().db);
  const manager = await s.f.user({ role: 'SITE_MANAGER' });
  await s.f.assignment(manager.id, s.project.id);
  for (const user of [manager, s.admin]) {
    const session = await s.f.session(user.id);
    const response = await request(options, session.token, '/api/ledger/options');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.drivers.map((r: { id: string }) => r.id)).toContain(s.driver.id);
    expect(JSON.stringify(body)).not.toMatch(/"(phone|biz_no|bank_account|contact_name)":/);
  }
});
