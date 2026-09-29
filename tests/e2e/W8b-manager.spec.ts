import { expect, test, type Page } from '@playwright/test';
import { createDatabase } from '../../src/server/db/client';
import { setupScenario } from '../helpers/factories';
import { createUse, submitUse } from '../../src/server/services/uses';

let fixtures: { login: string; id: string; useNo: string; otherNo: string }[];
test.beforeAll(async () => {
  const database = createDatabase(process.env.DATABASE_URL!);
  fixtures = [];
  try {
    for (const width of [1440, 390, 360]) {
      const s = await setupScenario(database.db);
      const use = await createUse(s.adminCtx, {
        ...s.input,
        trips: Array.from({ length: 3 }, (_, index) => ({
          seq: index + 1,
          origin: `W8b ${width} 항구`,
          destination: '현장',
        })),
        charge_lines: [
          { charge_type: 'BASE', quantity: '1' },
          { charge_type: 'TOLL', requested_amount: 5000, reason: '통행료 영수증' },
        ],
      });
      await submitUse(s.adminCtx, use.id, { version: use.version });
      const other = await createUse(s.adminCtx, { ...s.input, cargo_desc: '뒤로가기 검증' });
      fixtures.push({ login: s.admin.login_id, id: use.id, useNo: use.use_no, otherNo: other.use_no });
    }
  } finally {
    await database.pool.end();
  }
});

async function assertFits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  );
}

for (const [index, width] of [1440, 390, 360].entries()) {
  test(`W8b 사용대장·검수·메뉴·입력 ${width}px`, async ({ page }, testInfo) => {
    const fixture = fixtures[index];
    await page.setViewportSize({ width, height: 844 });
    await page.request.post('/api/auth/login', {
      data: { login_id: fixture.login, password: 'password1234' },
    });
    await page.goto(`/m/ledger?search=${fixture.useNo}`);
    const menu = page.getByRole('navigation', { name: '주 메뉴' });
    if (width < 768) {
      await expect(menu.getByRole('button', { name: '메뉴', exact: true })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      expect((await menu.boundingBox())!.height).toBeLessThan(70);
      await menu.getByRole('button', { name: '메뉴', exact: true }).click();
    }
    await expect(menu.getByRole('link', { name: '차량 사용대장', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    if (width < 768) await menu.getByRole('button', { name: '메뉴', exact: true }).click();
    const filters = page.getByRole('button', { name: /필터/ });
    if (width < 768) {
      await expect(filters).toContainText('필터 (1)');
      await expect(page.getByLabel('검색어', { exact: true })).toBeHidden();
      await filters.click();
    }
    await page.getByLabel('검색어', { exact: true }).fill(fixture.otherNo);
    await page.getByRole('button', { name: '조회', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`search=${fixture.otherNo}`));
    await expect(page.getByRole('link', { name: fixture.otherNo, exact: true })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`search=${fixture.useNo}`));
    await expect(page.getByRole('link', { name: fixture.useNo, exact: true })).toBeVisible();
    if (width < 768) await filters.click();
    await expect(page.getByLabel('검색어', { exact: true })).toHaveValue(fixture.useNo);
    if (width < 768) await filters.click();
    const result = width < 768 ? page.getByLabel('사용대장 카드 목록') : page.locator('table');
    await expect(result).toContainText('외 2회');
    await expect(result).toContainText('미정산');
    await assertFits(page);
    if (width === 1440) {
      const lastHeader = page.getByRole('columnheader', { name: '지급상태', exact: true });
      const bounds = (await lastHeader.boundingBox())!;
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect((await page.locator('main').boundingBox())!.width).toBeGreaterThan(1200);
    }
    await page.screenshot({ path: testInfo.outputPath(`ledger-${width}.png`), fullPage: true });
    await page.getByRole('link', { name: fixture.useNo, exact: true }).click();
    await expect(page.getByRole('heading', { name: fixture.useNo })).toBeVisible();
    const toll = page.getByTestId('charge-TOLL');
    await expect(toll.locator('[data-label="단위"]')).toHaveText('건');
    await expect(toll.locator('[data-label="세액"]')).toBeVisible();
    await expect(page.getByText('—시간', { exact: false })).toHaveCount(0);
    await expect(page.getByText('출발 —', { exact: false })).toHaveCount(0);
    if (width < 768) {
      expect(await toll.evaluate((element) => getComputedStyle(element).display)).toBe('grid');
      const bounds = (await toll.boundingBox())!;
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    }
    await toll.getByLabel('통행료 검수 결정').selectOption('HELD');
    await toll.getByLabel('통행료 검수 사유').fill('영수증 확인 중');
    await toll.getByRole('button', { name: '적용', exact: true }).click();
    await expect(toll.locator('[data-label="현재 상태"]')).toContainText('보류');
    await expect(page.getByRole('button', { name: '전체 승인 (보류·반려 제외)', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '전체 승인 (보류·반려 제외)', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '검수가 완료되었습니다' })).toBeVisible();
    await expect(page.getByTestId('charge-BASE').locator('[data-label="현재 상태"]')).toContainText('승인');
    await assertFits(page);
    await page.screenshot({ path: testInfo.outputPath(`review-${width}.png`), fullPage: true });

    for (const route of [
      '/m/users',
      '/m/import',
      '/m/master/rates',
      '/m/statements',
      '/m/payments',
      '/m/audit',
    ]) {
      await page.goto(route);
      await expect(page.locator('h1')).toBeVisible();
      await assertFits(page);
      const tooSmall = await page
        .locator('input, select, textarea')
        .evaluateAll((elements) =>
          elements
            .filter(
              (element) =>
                element.getClientRects().length && parseFloat(getComputedStyle(element).fontSize) < 16,
            )
            .map((element) => element.outerHTML.slice(0, 140)),
        );
      expect(tooSmall, route).toEqual([]);
      const logo = page.getByRole('link', { name: '차량 사용·정산', exact: true });
      expect((await logo.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });
}
