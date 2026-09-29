import { expect, test } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../../src/server/db/client';
import { factories } from '../helpers/factories';
import { users } from '../../src/server/db/schema';
import { createUse } from '../../src/server/services/uses';

test('14. 모바일 내 운행 사용일 순서·본인 기본 금액·보조 복사 버튼', async ({ page }) => {
  const database = createDatabase(process.env.DATABASE_URL!);
  let first: string;
  let second: string;
  try {
    const f = factories(database.db);
    const [driver] = await database.db.select().from(users).where(eq(users.login_id, 'driver1'));
    const [admin] = await database.db.select().from(users).where(eq(users.login_id, 'admin'));
    const project = await f.project({ name: 'W7 기사 표시 현장' });
    const vehicle = await f.vehicle();
    const payee = await f.counterparty();
    await f.assignment(driver.id, project.id);
    await f.rate(payee.id, { unit_price: 123456 });
    const input = {
      project_id: project.id,
      driver_id: driver.driver_id!,
      vehicle_id: vehicle.id,
      payee_counterparty_id: payee.id,
      use_date: '2026-09-29',
    };
    first = (await createUse(f.context(admin), { ...input, cargo_desc: 'W7 먼저 입력' })).id;
    second = (await createUse(f.context(admin), { ...input, cargo_desc: 'W7 나중 입력' })).id;
    await createUse(f.context(admin), {
      ...input,
      use_date: '2026-09-28',
      cargo_desc: 'W7 과거일 늦은 입력',
    });
  } finally {
    await database.pool.end();
  }
  await page.setViewportSize({ width: 360, height: 800 });
  await page.request.post('/api/auth/login', { data: { login_id: 'driver1', password: 'demo1234' } });
  await page.goto('/d');
  const list = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: '내 운행', exact: true }) });
  await expect(list.locator(`a[href="/d/uses/${first!}"]`)).toBeVisible();
  const links = await list
    .locator('a')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')));
  expect(links.indexOf(`/d/uses/${first!}`)).toBeLessThan(links.indexOf(`/d/uses/${second!}`));
  const card = list.locator('li').filter({ hasText: 'W7 먼저 입력' });
  await expect(card.getByText('123,456원', { exact: false })).toBeVisible();
  // 복사는 목록 카드 대신 상단 "지난번과 같은 운행"과 상세 화면에서 한다.
  await expect(page.getByRole('button', { name: /지난번과 같은 운행/ })).toBeVisible();
  await expect(card.getByRole('button', { name: '이전 운행 복사' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  await page.screenshot({ path: 'test-results/W7-driver-360px.png', fullPage: true });
});
