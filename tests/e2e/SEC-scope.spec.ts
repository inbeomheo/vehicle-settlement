import { expect, test } from '@playwright/test';
import { createDatabase } from '../../src/server/db/client';
import { setupScenario } from '../helpers/factories';
import { fillFlowFields } from './submit-helper';

const database = createDatabase(process.env.DATABASE_URL!);
test.afterAll(async () => database.pool.end());
test.setTimeout(90000);

test('SEC-01 현장 담당자는 활성 이름 선택지로 대리 입력하고 기준정보 우회는 거부된다', async ({ page }) => {
  const own = await setupScenario(database.db);
  const other = await setupScenario(database.db);
  const manager = await own.f.user({ role: 'SITE_MANAGER' });
  await own.f.assignment(manager.id, own.project.id);
  await page.request.post('/api/auth/login', {
    data: { login_id: manager.login_id, password: 'password1234' },
  });
  for (const resource of ['drivers', 'counterparties', 'vehicles', 'projects', 'rates']) {
    expect((await page.request.get(`/api/admin/${resource}`)).status()).toBe(403);
  }
  await page.goto('/m/uses/new');
  await expect(page.getByRole('heading', { name: '대리 입력', exact: true })).toBeVisible();
  const driver = page.getByLabel('실제 기사', { exact: true });
  await expect(driver.locator(`option[value="${own.driver.id}"]`)).toHaveCount(1);
  await expect(driver.locator(`option[value="${other.driver.id}"]`)).toHaveCount(1);
  await expect(
    page.getByLabel('현장', { exact: true }).locator(`option[value="${other.project.id}"]`),
  ).toHaveCount(0);
  const lookups = await page.request.get('/api/lookups');
  expect(JSON.stringify(await lookups.json())).not.toMatch(/"(phone|biz_no|bank_account|contact_name)":/);
  await driver.selectOption(own.driver.id);
  await page.getByLabel('현장', { exact: true }).selectOption(own.project.id);
  await expect(page.getByLabel('차량', { exact: true })).toHaveValue(own.vehicle.id);
  await expect(page.getByText('기본운임 300,000원', { exact: true })).toBeVisible();
  await fillFlowFields(page);
  await page.getByLabel('1회차 출발', { exact: true }).fill('보안 검증 상차장');
  await page.getByLabel('1회차 도착', { exact: true }).fill('보안 검증 현장');
  const submission = page.waitForResponse(
    (response) => response.url().includes('/submit') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '검수 대기로 제출', exact: true }).click();
  const response = await submission;
  expect(response.ok()).toBe(true);
  const submitted = (await response.json()).data;
  await expect(page).toHaveURL(`/m/uses/${submitted.id}`);
  await page.goto('/m/import');
  const csv = [
    '사용일,현장,기사,차량번호,지급처,출발지,도착지,과금단위,단가',
    `2026-09-15,${own.project.id},${own.driver.id},${own.vehicle.id},${own.payee.id},허용 상차장,허용 현장,일대,`,
    `2026-09-15,${other.project.id},${other.driver.id},${other.vehicle.id},${other.payee.id},다른 상차장,다른 현장,일대,`,
  ].join('\n');
  await page
    .getByLabel('가져올 파일')
    .setInputFiles({ name: 'SEC-현장범위.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByRole('button', { name: '미리보기 검증' }).click();
  await expect(page.getByRole('status').filter({ hasText: '유효 1건 · 오류 1건' })).toBeVisible();
  await page.getByRole('button', { name: '유효 행 임시저장' }).click();
  await expect(page.getByRole('status').filter({ hasText: '1건을 임시저장' })).toBeVisible();
});
