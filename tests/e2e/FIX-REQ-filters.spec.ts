import { expect, test, type Page } from '@playwright/test';
import { createDatabase } from '../../src/server/db/client';
import { setupScenario } from '../helpers/factories';
import { createUse } from '../../src/server/services/uses';
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
test('360px 아주 크게: 기사 운송내역·담당자 필터와 URL 새로고침·뒤로가기 복원', async ({ page }) => {
  const s = await setupScenario(database.db);
  const reviewer = await s.f.user({ name: '검색 담당자' });
  await createUse(s.driverCtx, { ...s.input, reviewer_user_id: reviewer.id, cargo_desc: '배관 검색' });
  await createUse(s.driverCtx, { ...s.input, cargo_desc: '자재' });
  await page.setViewportSize({ width: 360, height: 900 });
  await page.addInitScript(() => localStorage.setItem('vehicle-text-size', 'xlarge'));
  await login(page, s.driverUser.login_id);
  await page.goto('/d');
  const list = page.locator('section[aria-labelledby="my-uses"]');
  await expect(list.locator('li')).toHaveCount(2);
  await list.locator('summary').click();
  await list.getByLabel('운송내역 검색', { exact: true }).fill('배관');
  await list.getByRole('button', { name: '검색', exact: true }).click();
  await list.getByLabel('담당자', { exact: true }).selectOption(reviewer.id);
  await expect(list.locator('li')).toHaveCount(1);
  await expect(page).toHaveURL(new RegExp(`reviewer_user_id=${reviewer.id}`));
  await fits(page);
  await page.reload();
  await list.locator('summary').click();
  await expect(list.getByLabel('운송내역 검색', { exact: true })).toHaveValue('배관');
  await expect(list.getByLabel('담당자', { exact: true })).toHaveValue(reviewer.id);
  await list.getByLabel('운송내역 검색', { exact: true }).fill('없는 내용');
  await list.getByRole('button', { name: '검색', exact: true }).click();
  await expect(list.locator('li')).toHaveCount(0);
  await page.goBack();
  await expect(list.getByLabel('운송내역 검색', { exact: true })).toHaveValue('배관');
  await expect(list.locator('li')).toHaveCount(1);
  await fits(page);
  await page.screenshot({ path: test.info().outputPath('driver-filters-360.png'), fullPage: true });
});
