import { expect, test, type Page } from '@playwright/test';
import { createDatabase } from '../../src/server/db/client';
import { setupScenario } from '../helpers/factories';
const database = createDatabase(process.env.DATABASE_URL!);
test.afterAll(() => database.pool.end());
test.setTimeout(90000);
async function login(page: Page, login_id: string) {
  expect(
    (await page.request.post('/api/auth/login', { data: { login_id, password: 'password1234' } })).ok(),
  ).toBe(true);
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
test('기사관리에서 정산 담당자가 소속 시작일을 고친다', async ({ page }) => {
  const s = await setupScenario(database.db);
  const manager = await s.f.user({ role: 'SETTLEMENT_MANAGER' });
  await login(page, manager.login_id);
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto('/m/drivers');
  await page.getByLabel('기사 검색', { exact: true }).fill(s.driverUser.login_id);
  await page.getByLabel('기사 카드 목록').getByRole('button', { name: '소속 시작일 수정' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('소속 시작일', { exact: true }).fill('2019-01-01');
  await dialog.getByRole('button', { name: '소속 시작일 저장' }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await page.getByLabel('기사 검색', { exact: true }).fill(s.driverUser.login_id);
  await page.getByLabel('기사 카드 목록').getByRole('button', { name: '소속 시작일 수정' }).click();
  await expect(dialog.getByLabel('소속 시작일', { exact: true })).toHaveValue('2019-01-01');
  await fits(page);
});
