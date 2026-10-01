import { expect, test, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../../src/server/db/client';
import { vehicleUses } from '../../src/server/db/schema';
import { setupScenario } from '../helpers/factories';
import { createUse, submitUse, getUse } from '../../src/server/services/uses';
import { todaySeoul } from '../../src/server/context';
import { shiftDay } from '../../src/shared/approvals';
const database = createDatabase(process.env.DATABASE_URL!);
test.afterAll(async () => database.pool.end());
test.setTimeout(120000);
async function setup() {
  const s = await setupScenario(database.db);
  const manager = await s.f.user({ role: 'SITE_MANAGER', name: '이은총' });
  await s.f.assignment(manager.id, s.project.id);
  const uses = [];
  for (let i = 0; i < 3; i++) {
    let use = await createUse(s.driverCtx, {
      ...s.input,
      use_date: i === 2 ? shiftDay(todaySeoul(), -1) : todaySeoul(),
      quantity: '1',
      trips: [{ seq: 1, origin: '탕정 공장', destination: '용인 배관 현장' }],
      cargo_desc: 'LIST 배관 운반',
    });
    use = await submitUse(s.driverCtx, use.id, { version: use.version });
    await database.db
      .update(vehicleUses)
      .set({ reviewer_user_id: manager.id })
      .where(eq(vehicleUses.id, use.id));
    uses.push(use);
  }
  return { ...s, manager, uses };
}
async function login(page: Page, login_id: string, path: string) {
  await page.request.post('/api/auth/login', { data: { login_id, password: 'password1234' } });
  await page.goto(path);
}
const table = (page: Page) => page.getByLabel('운행 결재 표', { exact: true });
test('1440px 탭·필터·하루 이동·URL 복원·엑셀과 선택 승인', async ({ page }, testInfo) => {
  const s = await setup();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page, s.manager.login_id, '/m/approvals');
  await expect(page.getByRole('heading', { name: '운행 결재', exact: true })).toBeVisible();
  await expect(table(page).locator('tbody tr')).toHaveCount(2);
  await page.getByRole('button', { name: '검수대기 2', exact: true }).click();
  await page.locator('summary').filter({ hasText: '필터 ·' }).click();
  await page.getByRole('button', { name: '이전 날', exact: true }).click();
  await expect(table(page).locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: '다음 날', exact: true }).click();
  await expect(table(page).locator('tbody tr')).toHaveCount(2);
  await page.getByLabel('프로젝트', { exact: true }).selectOption(s.project.id);
  await page.getByLabel('기사명', { exact: true }).selectOption(s.driver.id);
  await page.getByLabel('담당자', { exact: true }).selectOption('me');
  await expect(table(page).locator('tbody tr')).toHaveCount(2);
  await page.getByLabel('운송내역 검색', { exact: true }).fill('없는 경로');
  await page.getByRole('button', { name: '검색', exact: true }).click();
  await expect(page.getByText('해당하는 운행이 없습니다. 날짜나 필터를 바꿔 보세요.')).toBeVisible();
  await page.goBack();
  await expect(table(page).locator('tbody tr')).toHaveCount(2);
  await page.reload();
  await page.locator('summary').filter({ hasText: '필터 ·' }).click();
  await expect(page.getByLabel('담당자', { exact: true })).toHaveValue('me');
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: '엑셀로 받기' }).click();
  expect((await download).suggestedFilename()).toBe('운행결재.xlsx');
  await page.getByRole('button', { name: '승인 가능 모두 선택' }).click();
  await page.getByRole('button', { name: '선택 승인 (2)', exact: true }).click();
  await expect(page.getByText('2건 승인했습니다.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '결재완료 2', exact: true }).click();
  await expect(table(page).locator('tbody tr')).toHaveCount(2);
  expect((await getUse(s.adminCtx, s.uses[0].id)).review_status).toBe('APPROVED');
  await page.screenshot({ path: testInfo.outputPath('LIST-desktop.png'), fullPage: true });
});
test('390·360px 카드·접는 필터와 보통·아주 크게 글자에서 가로 넘침 없음', async ({ page }, testInfo) => {
  const s = await setup();
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, s.manager.login_id, '/m/approvals');
  const cards = page.getByLabel('운행 결재 카드 목록', { exact: true });
  await expect(cards.locator('article')).toHaveCount(2);
  await expect(table(page)).toBeHidden();
  await page.locator('summary').filter({ hasText: '필터 ·' }).click();
  const filters = page.locator('details').filter({ hasText: '필터 ·' });
  await filters.getByRole('button', { name: '이전 날' }).click();
  await expect(cards.locator('article')).toHaveCount(1);
  await filters.getByRole('button', { name: '오늘', exact: true }).click();
  await expect(cards.locator('article')).toHaveCount(2);
  for (const width of [390, 360])
    for (const size of [16, 20]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = `${size}px`;
      }, size);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await expect(filters.getByLabel('운송 시작일')).toBeVisible();
    }
  await page.screenshot({ path: testInfo.outputPath('LIST-mobile-large.png'), fullPage: true });
});
test('기사 홈은 본인 목록·상태·기간·프로젝트를 유지하고 큰 등록·지난번 복사를 제공한다', async ({
  page,
}, testInfo) => {
  const s = await setup();
  const other = await s.f.driver({ name: '타인 기사' });
  await s.f.affiliation(other.id, s.payee.id);
  await createUse(s.adminCtx, {
    ...s.input,
    driver_id: other.id,
    use_date: todaySeoul(),
    cargo_desc: '남의 운행',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, s.driverUser.login_id, '/d');
  const list = page.locator('section[aria-labelledby="my-uses"]');
  await expect(list.locator('li')).toHaveCount(3);
  await expect(list.getByRole('button', { name: '전체 3', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('link', { name: '운행 등록', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /지난번과 같은 운행/ })).toBeVisible();
  await list.getByRole('button', { name: '검수대기 3', exact: true }).click();
  await list.locator('summary').click();
  await list.getByRole('button', { name: '이전 날' }).click();
  await expect(list.locator('li')).toHaveCount(1);
  await list.getByLabel('프로젝트', { exact: true }).selectOption(s.project.id);
  await page.reload();
  await list.locator('summary').click();
  await expect(list.getByLabel('프로젝트', { exact: true })).toHaveValue(s.project.id);
  await expect(list.locator('li')).toHaveCount(1);
  await list.getByRole('button', { name: '전체 기간', exact: true }).click();
  await expect(list.locator('li')).toHaveCount(3);
  await expect(list.getByLabel('운송 시작일')).toHaveValue('');
  await expect(list.getByLabel('운송 종료일')).toHaveValue('');
  await page.goBack();
  await expect(list.locator('li')).toHaveCount(1);
  const api = await page.request.get(
    `/api/approvals?from=${todaySeoul()}&to=${todaySeoul()}&driver_id=${other.id}`,
  );
  expect((await api.json()).data.total).toBe(0);
  await page.setViewportSize({ width: 360, height: 844 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '20px';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('LIST-driver-large.png'), fullPage: true });
});
