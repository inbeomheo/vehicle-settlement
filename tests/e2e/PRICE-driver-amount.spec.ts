import { fillFlowFields } from './submit-helper';
import { expect, test, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../../src/server/db/client';
import { rateAgreements, vehicleUses } from '../../src/server/db/schema';
import { setupScenario } from '../helpers/factories';
import { getUse } from '../../src/server/services/uses';

const database = createDatabase(process.env.DATABASE_URL!);
test.use({ viewport: { width: 360, height: 780 }, actionTimeout: 15000 });
test.setTimeout(90000);
test.afterAll(async () => database.pool.end());
async function fixture(contract = false) {
  const s = await setupScenario(database.db);
  if (!contract)
    await database.db.update(rateAgreements).set({ active: false }).where(eq(rateAgreements.id, s.rate.id));
  const manager = await s.f.user({ role: 'SITE_MANAGER', name: '금액 확인 담당자' });
  await s.f.assignment(manager.id, s.project.id);
  return { ...s, manager };
}
async function login(page: Page, loginId: string, path: string) {
  await page.addInitScript(() => localStorage.setItem('vehicle-text-size', 'xlarge'));
  const response = await page.request.post('/api/auth/login', {
    data: { login_id: loginId, password: 'password1234' },
  });
  expect(response.ok()).toBe(true);
  await page.goto(path);
}
async function enterRoute(page: Page) {
  await page.getByLabel('1회차 출발', { exact: true }).fill('둔포');
  await page.getByLabel('1회차 도착', { exact: true }).fill('P5 현장');
}
async function send(page: Page, amount: string) {
  await fillFlowFields(page);
  await page.getByRole('button', { name: '담당자에게 보내기', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: '이대로 보낼까요?' });
  await expect(sheet).toContainText(`${amount}원`);
  await sheet.getByRole('button', { name: '보내기', exact: true }).click();
  await page.waitForURL(/\/d\/uses\/[^?]+\?submitted=1/, { waitUntil: 'domcontentloaded', timeout: 15000 });
  // The destination hydrates and fetches the submitted detail before rendering success.
  await expect(page.getByRole('heading', { name: '보냈습니다', exact: true })).toBeVisible({
    timeout: 15000,
  });
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('20px');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
}

test('360px·20px: 기사 금액 → 보내기 확인 → 담당자 바로 승인 → 내 정산, 최근 경로 금액', async ({
  page,
}, info) => {
  const s = await fixture();
  await login(page, s.driverUser.login_id, `/d/new?project=${s.project.id}`);
  await enterRoute(page);
  const amount = page.getByLabel('이번 운행 금액(원)', { exact: true });
  await expect(amount).toHaveAttribute('inputmode', 'numeric');
  await amount.fill('1234567');
  await expect(amount).toHaveValue('1,234,567');
  expect((await amount.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await amount.fill('140000');
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('driver-amount-360-20.png'), fullPage: true });
  await send(page, '140,000');
  const [use] = await database.db.select().from(vehicleUses).where(eq(vehicleUses.driver_id, s.driver.id));
  await page.goto('/d');
  await expect(page.locator(`a[href="/d/uses/${use.id}"]`).first()).toContainText('140,000');
  await login(page, s.manager.login_id, '/m/review');
  const card = page.locator('article').filter({ hasText: use.use_no });
  await expect(card).toContainText('140,000');
  await expect(card.getByText('단가 미확정', { exact: true })).toHaveCount(0);
  await card.getByRole('button', { name: '바로 승인', exact: true }).click();
  await expect(card).toContainText('승인');
  await expect.poll(async () => (await getUse(s.adminCtx, use.id)).review_status).toBe('APPROVED');
  await login(page, s.driverUser.login_id, `/d/settlements?month=${use.use_date.slice(0, 7)}`);
  await expect(page.getByLabel('기간 운행 합계')).toContainText('승인 140,000원');
  await noOverflow(page);
  await page.goto(`/d/new?project=${s.project.id}`);
  await page
    .getByRole('group', { name: '1회차 최근 경로', exact: true })
    .getByRole('button', { name: '둔포 → P5 현장', exact: true })
    .click();
  await expect(amount).toHaveValue('140,000');
  await expect(page.getByText('지난번 이 구간 금액', { exact: true })).toBeVisible();
  await amount.fill('150000');
  await page
    .getByRole('group', { name: '1회차 최근 경로', exact: true })
    .getByRole('button', { name: '둔포 → P5 현장', exact: true })
    .click();
  await expect(amount).toHaveValue('150,000');
  await noOverflow(page);
});

test('계약과 다른 요청액은 바로 승인에서 제외하고 상세의 요청액·공급가 기본값으로 확인한다', async ({
  page,
}, info) => {
  const s = await fixture(true);
  await login(page, s.driverUser.login_id, `/d/new?project=${s.project.id}`);
  await enterRoute(page);
  await page.getByRole('button', { name: '금액이 다르면 직접 입력', exact: true }).click();
  const amount = page.getByLabel('이번 운행 금액(원)', { exact: true });
  await amount.fill('350000');
  await amount.fill('');
  await fillFlowFields(page);
  await page.getByRole('button', { name: '담당자에게 보내기', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('300,000원');
  await page.getByRole('button', { name: '고치기', exact: true }).click();
  await amount.fill('350000');
  await send(page, '350,000');
  const [use] = await database.db.select().from(vehicleUses).where(eq(vehicleUses.driver_id, s.driver.id));
  await login(page, s.manager.login_id, '/m/review');
  const card = page.locator('article').filter({ hasText: use.use_no });
  await expect(card.getByText('계약 단가와 다른 금액', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: '바로 승인', exact: true })).toHaveCount(0);
  await noOverflow(page);
  await page.goto(`/m/uses/${use.id}`);
  const line = page.getByTestId('charge-BASE');
  await expect(line.locator('[data-label="요청액"]')).toContainText('350,000');
  await expect(line.getByText('계약 단가와 다름', { exact: true })).toBeVisible();
  await expect(line.getByLabel('기본운임 승인 공급가', { exact: true })).toHaveAttribute(
    'placeholder',
    '350,000',
  );
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('manager-difference-360-20.png'), fullPage: true });
  await page.getByRole('button', { name: '전체 승인 (보류·반려 제외)', exact: true }).click();
  await expect
    .poll(async () => (await getUse(s.adminCtx, use.id)).charge_lines[0].approved_amount)
    .toBe(350000);
});

test('오프라인 기기 초안·새로고침·재전송에서 운행 금액을 보존한다', async ({ page, context }) => {
  const s = await fixture();
  await login(page, s.driverUser.login_id, `/d/new?project=${s.project.id}`);
  await enterRoute(page);
  await page.getByLabel('이번 운행 금액(원)', { exact: true }).fill('170000');
  await expect(page.getByRole('status')).toContainText('휴대폰에만 저장됨');
  await context.setOffline(true);
  await page.getByLabel('이번 운행 금액(원)', { exact: true }).fill('180000');
  await expect(page.getByRole('status')).toContainText('휴대폰에만 저장됨');
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByLabel('이번 운행 금액(원)', { exact: true })).toHaveValue('180,000');
  await send(page, '180,000');
  const [use] = await database.db.select().from(vehicleUses).where(eq(vehicleUses.driver_id, s.driver.id));
  expect((await getUse(s.driverCtx, use.id)).charge_lines[0].requested_amount).toBe(180000);
});

test('대리 입력도 운행 금액을 저장한다', async ({ page }) => {
  const s = await fixture();
  await login(page, s.manager.login_id, `/m/uses/new?project=${s.project.id}`);
  await page.getByLabel('실제 기사', { exact: true }).selectOption(s.driver.id);
  await enterRoute(page);
  await page.getByLabel('이번 운행 금액(원)', { exact: true }).fill('130000');
  await page.getByRole('button', { name: '서버 저장', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await database.db.select().from(vehicleUses).where(eq(vehicleUses.driver_id, s.driver.id))).length,
    )
    .toBe(1);
  const [use] = await database.db.select().from(vehicleUses).where(eq(vehicleUses.driver_id, s.driver.id));
  expect(await getUse(s.adminCtx, use.id)).toMatchObject({
    entered_as: 'PROXY',
    charge_lines: [expect.objectContaining({ requested_amount: 130000 })],
  });
});

test('생성 응답 유실 뒤 재전송은 원래 금액으로 복구하고 새 금액을 같은 줄에 저장한다', async ({ page }) => {
  const s = await fixture();
  await login(page, s.driverUser.login_id, `/d/new?project=${s.project.id}`);
  await enterRoute(page);
  await page.getByLabel('이번 운행 금액(원)', { exact: true }).fill('170000');
  let created = false;
  let recovered = false;
  const posts: string[] = [];
  await page.route('**/api/uses', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    posts.push(route.request().postData()!);
    if (recovered) return route.continue();
    if (!created) {
      await route.fetch();
      created = true;
    }
    await route.abort('failed');
  });
  await page.getByLabel('사진·파일 선택', { exact: true }).setInputFiles('public/icons/icon-192.png');
  await page.getByRole('button', { name: '서버 저장', exact: true }).click();
  await expect(page.locator('#form-errors')).toBeVisible();
  await page.getByRole('button', { name: '첨부 취소', exact: true }).click();
  await expect(page.getByLabel('이번 운행 금액(원)', { exact: true })).toBeEnabled();
  const [use] = await database.db.select().from(vehicleUses).where(eq(vehicleUses.driver_id, s.driver.id));
  const original = await getUse(s.driverCtx, use.id);
  await page.reload();
  await page.getByLabel('이번 운행 금액(원)', { exact: true }).fill('190000');
  recovered = true;
  await page.getByRole('button', { name: '서버 저장', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('작성 중 · 아직 안 보냄');
  expect(posts.length).toBeGreaterThanOrEqual(2);
  expect(posts.every((body) => body === posts[0])).toBe(true);
  const saved = await getUse(s.driverCtx, use.id);
  expect(saved.charge_lines).toHaveLength(1);
  expect(saved.charge_lines[0]).toMatchObject({ id: original.charge_lines[0].id, requested_amount: 190000 });
});

test.describe('제출 완료 이동 회귀', () => {
  test.use({ serviceWorkers: 'block' });
  test('보내기 완료는 한 번만 이동하고 느린 상세 조회 뒤 완료 화면을 표시한다', async ({ page }) => {
    const s = await fixture();
    await login(page, s.driverUser.login_id, `/d/new?project=${s.project.id}`);
    await enterRoute(page);
    await page.getByLabel('이번 운행 금액(원)', { exact: true }).fill('140000');
    let navigations = 0;
    await page.route('**/d/uses/*?submitted=1', async (route) => {
      navigations++;
      // Let both the queue event and the send handler observe completion before unloading.
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
    });
    let delayed = false;
    await page.route('**/api/uses/*', async (route) => {
      if (
        route.request().method() === 'GET' &&
        page.url().includes('submitted=1') &&
        /\/api\/uses\/[0-9a-f-]{36}$/.test(route.request().url())
      ) {
        delayed = true;
        await new Promise((resolve) => setTimeout(resolve, 6500));
      }
      await route.continue();
    });
    await send(page, '140,000');
    expect(delayed).toBe(true);
    expect(navigations).toBe(1);
    const [use] = await database.db.select().from(vehicleUses).where(eq(vehicleUses.driver_id, s.driver.id));
    expect((await getUse(s.driverCtx, use.id)).review_status).toBe('SUBMITTED');
  });
});
