import { expect, test } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../../src/server/db/client';
import { rateAgreements } from '../../src/server/db/schema';
import { setupScenario } from '../helpers/factories';
import { createUse } from '../../src/server/services/uses';

const database = createDatabase(process.env.DATABASE_URL!);
test.use({ viewport: { width: 360, height: 800 } });
test.setTimeout(120000);
test.afterAll(async () => database.pool.end());

test('대리 입력 신규·수정 문맥, 실제 기사 변경 시 차량·단위·단가 재조회와 16px·44px', async ({ page }) => {
  const first = await setupScenario(database.db);
  const second = await setupScenario(database.db);
  await database.db
    .update(rateAgreements)
    .set({ billing_unit: 'PER_TRIP', unit_price: 123456 })
    .where(eq(rateAgreements.id, second.rate.id));
  const use = await createUse(first.adminCtx, {
    ...first.input,
    trips: [{ seq: 1, origin: '기존 상차', destination: '기존 하차' }],
  });
  await page.request.post('/api/auth/login', {
    data: { login_id: first.admin.login_id, password: 'password1234' },
  });
  await page.goto('/m/uses/new');
  await expect(page.getByRole('heading', { name: '대리 입력', exact: true })).toBeVisible();
  await page.getByLabel('실제 기사', { exact: true }).selectOption(first.driver.id);
  await page.getByLabel('현장', { exact: true }).selectOption(first.project.id);
  await expect(page.getByLabel('과금 단위', { exact: true })).toHaveValue('PER_DAY');
  await expect(page.getByText('기본운임 300,000원', { exact: true })).toBeVisible();
  await page.getByLabel('실제 기사', { exact: true }).selectOption(second.driver.id);
  await expect(page.getByLabel('차량', { exact: true })).toHaveValue(second.vehicle.id);
  await expect(page.getByLabel('과금 단위', { exact: true })).toHaveValue('PER_TRIP');
  await expect(page.getByText('회당·건당 · 단가 123,456원', { exact: true })).toBeVisible();
  await expect(page.getByLabel('청구수량', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: '검수 대기로 제출', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('이 기기에 임시저장됨');
  await page.getByText('1회차 상세 입력', { exact: true }).click();
  await page.getByRole('button', { name: '+ 추가 비용', exact: true }).click();
  const bad = await page
    .locator('main input:not([type=file]),main select,main textarea')
    .evaluateAll((elements) =>
      elements
        .filter(
          (e) =>
            e.getBoundingClientRect().height > 0 &&
            (parseFloat(getComputedStyle(e).fontSize) < 16 ||
              // 체크박스·라디오는 감싼 label 전체가 터치 영역이다.
              (e.closest('label') ?? e).getBoundingClientRect().height < 44),
        )
        .map((e) => e.outerHTML),
    );
  expect(bad).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  await page.goto(`/m/uses/${use.id}/edit`);
  await expect(page.getByRole('heading', { name: '대리 입력', exact: true })).toBeVisible();
  await page.getByLabel('실제 기사', { exact: true }).selectOption(second.driver.id);
  await expect(page.getByLabel('과금 단위', { exact: true })).toHaveValue('PER_TRIP');
  await expect(page.getByText('회당·건당 · 단가 123,456원', { exact: true })).toBeVisible();
});
