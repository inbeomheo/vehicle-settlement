import { expect, it } from 'vitest';
import { testDatabase } from '../helpers/database';
import { factories, setupScenario } from '../helpers/factories';
import { callRoute } from '../helpers/routes';
import { GET } from '../../src/app/api/setup-status/route';
import { getSetupStatus } from '../../src/server/services/setup-status';
import { companySettings } from '../../src/server/db/schema';

const database = testDatabase();

it('빈 상태에서 시작 준비 항목이 모두 0이고, 등록하면 채워진다', async () => {
  const { db } = database();
  const f = factories(db);
  const admin = await f.user();
  const empty = await getSetupStatus(f.context(admin));
  expect(empty).toMatchObject({
    company: 0,
    projects: 0,
    vehicles: 0,
    payees: 0,
    drivers: 0,
    rates: 0,
    people: 0,
  });

  const s = await setupScenario(db);
  await db.insert(companySettings).values({ name: '성건기업' });
  const filled = await getSetupStatus(s.adminCtx);
  for (const key of [
    'company',
    'projects',
    'vehicles',
    'payees',
    'drivers',
    'affiliations',
    'rates',
    'people',
  ])
    expect(filled[key], key).toBeGreaterThan(0);
});

it('관리자만 볼 수 있다', async () => {
  const { db } = database();
  const f = factories(db);
  for (const role of ['ADMIN', 'SITE_MANAGER', 'SETTLEMENT_MANAGER'] as const) {
    const user = await f.user({ role });
    const session = await f.session(user.id);
    const response = await callRoute(db, GET, { token: session.token });
    expect(response.status, role).toBe(role === 'ADMIN' ? 200 : 403);
  }
});
