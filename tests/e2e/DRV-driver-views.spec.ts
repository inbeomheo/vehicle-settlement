import { expect, test, type Page } from '@playwright/test';
import { createDatabase } from '../../src/server/db/client';
import { createUse } from '../../src/server/services/uses';
import { approved, confirmed, scenario } from '../integration/W4-fixtures';

const database = createDatabase(process.env.DATABASE_URL!);
test.use({ viewport: { width: 360, height: 780 }, actionTimeout: 15000 });
test.afterAll(async () => database.pool.end());

async function login(page: Page, loginId: string, path = '/d/settlements?month=2026-09') {
  await page.addInitScript(() => localStorage.setItem('vehicle-text-size', 'xlarge'));
  await page.request.post('/api/auth/login', { data: { login_id: loginId, password: 'password1234' } });
  await page.goto(path);
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const clipped = await page.locator('main .whitespace-nowrap').evaluateAll((elements) =>
    elements
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return (
          box.width > 0 &&
          (box.right > window.innerWidth || box.left < 0 || element.scrollWidth > element.clientWidth + 1)
        );
      })
      .map((element) => element.textContent),
  );
  expect(clipped).toEqual([]);
}

test('360px·아주 크게: 현장 펼치기 → 날짜별 → 직접 기간 → 새로고침·뒤로가기 → 상세', async ({
  page,
}, testInfo) => {
  const s = await scenario(database.db);
  const second = await s.f.project({ name: '배관공사 두 번째 긴 이름의 현장' });
  await s.f.assignment(s.driverUser.id, second.id);
  const first = await approved(s, { use_date: '2026-08-19' });
  const latest = await approved(s, {
    use_date: '2026-09-18',
    project_id: second.id,
    trips: [
      { seq: 1, origin: '자재 창고', destination: '배관공사 현장' },
      { seq: 2, origin: '자재 창고', destination: '배관공사 현장' },
    ],
  });
  await createUse(s.driverCtx, { ...s.input, use_date: '2026-09-19' });
  await confirmed(
    s,
    latest.charge_lines.map((line) => line.id),
  );
  await login(page, s.driverUser.login_id);
  await expect(page.getByRole('heading', { name: '9월 운행', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '현장별', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('20px');
  await noOverflow(page);
  const project = page
    .locator('details')
    .filter({ has: page.locator('summary').filter({ hasText: second.name }) });
  await project.locator('summary').click();
  await expect(project.getByRole('link')).toContainText('자재 창고 → 배관공사 현장 외 1회');
  await expect(project.locator('summary')).toContainText('운행 1건 · 2회');
  await page.screenshot({ path: testInfo.outputPath('projects-360-20.png'), fullPage: true });
  await noOverflow(page);
  await page.getByRole('button', { name: '날짜별', exact: true }).click();
  await expect(page).toHaveURL(/view=date/);
  await expect(page.getByRole('heading', { name: '9월 18일 (금)', exact: true })).toBeVisible();
  await noOverflow(page);
  await page.getByRole('button', { name: '기간 직접 고르기', exact: true }).click();
  for (const label of ['시작일', '종료일']) {
    const input = page.getByLabel(label, { exact: true });
    expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await input.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBe(20);
  }
  await noOverflow(page);
  await page.getByLabel('시작일', { exact: true }).fill('2026-08-19');
  await page.getByLabel('종료일', { exact: true }).fill('2026-09-18');
  await page.getByRole('button', { name: '이 기간 보기', exact: true }).click();
  await expect(page).toHaveURL(/from=2026-08-19&to=2026-09-18/);
  await expect(page.getByText('8월 19일 ~ 9월 18일', { exact: true })).toBeVisible();
  await expect(page.getByLabel('기간 운행 합계')).toContainText('승인 600,000원');
  await expect(page.getByRole('heading', { name: '9월 19일 (토)', exact: true })).toHaveCount(0);
  await expect(page.locator(`a[href="/d/uses/${first.id}"]`)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '날짜별', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByLabel('기간 운행 합계')).toContainText('운행 2건');
  await page.screenshot({ path: testInfo.outputPath('dates-360-20.png'), fullPage: true });
  await noOverflow(page);
  await page.getByRole('button', { name: '월별로 돌아가기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '9월 운행', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: '선택 기간 운행', exact: true })).toBeVisible();
  await page.locator(`a[href="/d/uses/${latest.id}"]`).click();
  await expect(page).toHaveURL(`/d/uses/${latest.id}`);
});

test('기간 오류·빈 상태·API 실패 재시도·로딩·잘못된 월 URL', async ({ page }) => {
  const s = await scenario(database.db);
  await login(page, s.driverUser.login_id, '/d/settlements?month=2026-99');
  await expect(page.getByText('이 달 운행이 없습니다.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '기간 직접 고르기', exact: true }).click();
  await page.getByLabel('시작일', { exact: true }).fill('2026-09-19');
  await page.getByLabel('종료일', { exact: true }).fill('2026-09-18');
  await page.getByRole('button', { name: '이 기간 보기', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toHaveText('종료일은 시작일보다 빠를 수 없습니다.');
  await page.getByLabel('종료일', { exact: true }).fill('2027-09-19');
  await page.getByRole('button', { name: '이 기간 보기', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toHaveText('기간은 최대 1년까지 고를 수 있습니다.');
  await noOverflow(page);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/statements/mine?**', async (route) => {
    await gate;
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: '일시적인 오류입니다.' } }),
    });
  });
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: '불러오는 중' })).toBeVisible();
  release();
  await expect(page.locator('main').getByRole('alert')).toBeVisible();
  await page.unroute('**/api/statements/mine?**');
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(page.getByText('이 달 운행이 없습니다.', { exact: true })).toBeVisible();
  await page.goto('/d/settlements?from=invalid&to=2026-09-18');
  await expect(page.locator('main').getByRole('alert')).toBeVisible();
  await expect(page.getByText('기간을 확인해 주세요', { exact: true })).toBeVisible();
});
