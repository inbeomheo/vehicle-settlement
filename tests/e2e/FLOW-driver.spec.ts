import { expect, test } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../../src/server/db/client';
import { vehicleUses } from '../../src/server/db/schema';
import { setupScenario } from '../helpers/factories';
const database = createDatabase(process.env.DATABASE_URL!);
test.use({ viewport: { width: 360, height: 800 } });
test.setTimeout(90000);
test.afterAll(() => database.pool.end());
for (const size of ['normal', 'xlarge'])
  test(`FLOW 360px ${size}: 입력 순서·제출·내 담당 검수·보고서`, async ({ page }, info) => {
    const s = await setupScenario(database.db);
    const manager = await s.f.user({ role: 'SITE_MANAGER', name: `윤찬식-${size}` });
    await s.f.assignment(manager.id, s.project.id);
    await page.addInitScript((value) => localStorage.setItem('vehicle-text-size', value), size);
    await page.request.post('/api/auth/login', {
      data: { login_id: s.driverUser.login_id, password: 'password1234' },
    });
    await page.goto(`/d/new?project=${s.project.id}`);
    await page.getByRole('radio', { name: s.project.name, exact: true }).check();
    await page.getByLabel('사용일', { exact: true }).fill('2026-10-01');
    await page.getByRole('radio', { name: `${manager.name} (현장 담당자)`, exact: true }).check();
    await page.getByLabel('적재용량 (톤)').fill('2.5');
    await page.getByLabel('1회차 출발', { exact: true }).fill('성건2공장');
    await page.getByLabel('1회차 도착', { exact: true }).fill('탕정 배관공사');
    await page.getByRole('button', { name: '금액이 다르면 직접 입력', exact: true }).click();
    await page.getByLabel('이번 운행 금액(원)', { exact: true }).fill('300000');
    const order = await page
      .locator('[data-fix-target]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-fix-target')));
    for (const [before, after] of [
      ['project_id', 'use_date'],
      ['use_date', 'reviewer'],
      ['reviewer', 'load_tonnage'],
      ['load_tonnage', 'trips'],
    ])
      expect(order.indexOf(before)).toBeLessThan(order.indexOf(after));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    await page.screenshot({ path: info.outputPath(`flow-${size}.png`), fullPage: true });
    await page.getByRole('button', { name: '담당자에게 보내기', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: '이대로 보낼까요?' });
    await expect(sheet).toContainText(manager.name);
    await expect(sheet).toContainText('2.5톤');
    await sheet.getByRole('button', { name: '보내기', exact: true }).click();
    await expect(page.getByRole('heading', { name: '보냈습니다', exact: true })).toBeVisible();
    const [use] = await database.db.select().from(vehicleUses).where(eq(vehicleUses.driver_id, s.driver.id));
    await page.goto(`/d/new?project=${s.project.id}`);
    await expect(
      page.getByRole('radio', { name: `${manager.name} (현장 담당자)`, exact: true }),
    ).toBeChecked();
    await expect(page.getByRole('button', { name: '2.5톤', exact: true })).toBeVisible();
    const pdf = await page.request.get(`/api/uses/${use.id}/report.pdf`);
    expect(pdf.ok()).toBe(true);
    expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');
    await page.request.post('/api/auth/login', {
      data: { login_id: manager.login_id, password: 'password1234' },
    });
    await page.goto('/m/review');
    await expect(page.getByRole('button', { name: '내 담당만', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const card = page.locator('article').filter({ hasText: use.use_no });
    await expect(card).toContainText(manager.name);
    await expect(card).toContainText('2.5톤');
    await card.getByRole('button', { name: '바로 승인', exact: true }).click();
    await expect(card).toContainText('승인');
  });

test('FLOW 담당자·적재용량 오프라인 초안 복원·재전송', async ({ page, context }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const s = await setupScenario(database.db);
  await page.request.post('/api/auth/login', {
    data: { login_id: s.driverUser.login_id, password: 'password1234' },
  });
  await page.goto(`/d/new?project=${s.project.id}`);
  await page.locator(`input[name="reviewer_user_id"][value="${s.admin.id}"]`).check();
  await page.getByLabel('적재용량 (톤)').fill('3.5');
  await page.getByLabel('1회차 출발', { exact: true }).fill('오프라인 창고');
  await page.getByLabel('1회차 도착', { exact: true }).fill('오프라인 현장');
  await expect(page.getByRole('status')).toHaveText('휴대폰에만 저장됨');
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('적재용량 (톤)')).toHaveValue('3.5');
  await expect(page.locator(`input[name="reviewer_user_id"][value="${s.admin.id}"]`)).toBeChecked();
  await page.getByRole('button', { name: '담당자에게 보내기', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '보내기', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('제출 대기');
  expect(pageErrors).toEqual([]);
  await page.goto('/d');
  await expect(page.getByRole('heading', { name: '내 운행', exact: true })).toBeVisible();
  await page.getByRole('link').filter({ hasText: '휴대폰에만 저장됨' }).click();
  await expect(page.getByLabel('적재용량 (톤)')).toHaveValue('3.5');
  expect(pageErrors).toEqual([]);
  await context.setOffline(false);
  await expect(page.getByRole('heading', { name: '보냈습니다', exact: true })).toBeVisible();
  const uses = await database.db.select().from(vehicleUses).where(eq(vehicleUses.driver_id, s.driver.id));
  expect(uses).toHaveLength(1);
  expect(uses[0]).toMatchObject({
    reviewer_user_id: s.admin.id,
    load_tonnage: '3.500',
    review_status: 'SUBMITTED',
  });
});
