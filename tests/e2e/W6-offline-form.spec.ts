import 'dotenv/config';
import { test, expect, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { createDatabase, defaultDatabaseUrl } from '../../src/server/db/client';
import { setupScenario } from '../helpers/factories';
import { vehicleUses } from '../../src/server/db/schema';
import { saveFormSettings } from '../../src/server/services/form-settings';
import { getUse } from '../../src/server/services/uses';
import { submitDriverForm } from './submit-helper';

test.use({ viewport: { width: 360, height: 800 } });
test.setTimeout(120000);
const database = createDatabase(defaultDatabaseUrl());
test.afterAll(async () => database.pool.end());

async function openForm(page: Page, loginId: string) {
  await page.goto('/login');
  await page.getByLabel('아이디', { exact: true }).fill(loginId);
  await page.getByLabel('비밀번호', { exact: true }).fill('password1234');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page).toHaveURL(/\/d$/);
  await page.goto('/d/new');
  await page.getByLabel('1회차 출발', { exact: true }).fill('서울 자재 야적장');
  await page.getByLabel('1회차 도착', { exact: true }).fill('성수 현장');
}

test('360px 운행 상세 접기와 과금 필수 입력, 증빙 동작 중에만 사유 표시', async ({ page }) => {
  const scenario = await setupScenario(database.db);
  // This regression exercises optional detail inputs explicitly enabled by an administrator.
  await saveFormSettings(scenario.adminCtx, {
    project_id: scenario.project.id,
    fields: (
      ['via', 'quantity', 'hours', 'depart_at', 'arrive_at', 'quantity_unit', 'trip_notes'] as const
    ).map((field_key) => ({ field_key, driver_mode: 'OPTIONAL', manager_mode: null, version: 0 })),
  });
  await openForm(page, scenario.driverUser.login_id);
  const quantity = page.getByLabel('1회차 수량', { exact: true });
  const hours = page.getByLabel('1회차 시간', { exact: true });
  const via = page.getByLabel('1회차 경유 (쉼표 구분)', { exact: true });
  await expect(quantity).toBeHidden();
  await expect(hours).toBeHidden();
  await expect(via).toBeHidden();
  await expect(page.getByLabel('교체·삭제 사유')).toHaveCount(0);
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const disclosure = page.getByText('1회차 상세 입력', { exact: true });
  await disclosure.click();
  await expect(via).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(height + 400);
  await via.fill('동부 창고');
  await quantity.fill('5');
  await disclosure.click();
  await expect(via).toBeHidden();
  await expect(via).toHaveValue('동부 창고');
  await page.getByLabel('요금 기준', { exact: true }).selectOption('PER_TON');
  await expect(quantity).toBeVisible();
  await expect(quantity).toHaveValue('5');
  await expect(hours).toBeHidden();
  await page.getByLabel('요금 기준', { exact: true }).selectOption('PER_M3');
  await expect(quantity).toBeVisible();
  await page.getByLabel('요금 기준', { exact: true }).selectOption('PER_HOUR');
  await expect(hours).toBeVisible();
  await expect(quantity).toBeHidden();
  await page.getByLabel('요금 기준', { exact: true }).selectOption('PER_DAY');
  await page.getByLabel('사진·파일 선택', { exact: true }).setInputFiles('public/icons/icon-192.png');
  await page.getByRole('button', { name: '서버 저장', exact: true }).click();
  await expect(page.getByText('업로드 완료', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '교체', exact: true }).click();
  await expect(page.getByLabel('교체·삭제 사유')).toBeVisible();
  await page.getByRole('button', { name: '교체 취소', exact: true }).click();
  await expect(page.getByLabel('교체·삭제 사유')).toHaveCount(0);
  const evidence = page.locator('section[data-fix-target="evidence"]');
  await evidence.getByRole('button', { name: '삭제', exact: true }).click();
  await page.getByLabel('교체·삭제 사유').fill('잘못 첨부한 시연 사진');
  await page.getByRole('button', { name: '증빙 삭제 확인', exact: true }).click();
  await expect(page.getByText('업로드 완료', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('교체·삭제 사유')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/W6-form-360px.png', fullPage: true });
});

test('영구 첨부 실패는 오류 표시·첨부 취소·확인 후 기기 초안 폐기가 가능하다', async ({ page }) => {
  const scenario = await setupScenario(database.db);
  await openForm(page, scenario.driverUser.login_id);
  await page.route('**/api/uses/*/evidence', async (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'STATEMENT_LOCKED', message: '확정 명세에 포함되어 증빙을 변경할 수 없습니다.' },
      }),
    }),
  );
  await page.getByLabel('사진·파일 선택', { exact: true }).setInputFiles('public/icons/icon-192.png');
  await submitDriverForm(page);
  await expect(page.locator('#form-errors')).toContainText('확정 명세에 포함되어 증빙을 변경할 수 없습니다.');
  await expect(page.getByText('자동 재전송이 중단되었습니다.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: '사진 다시 보내기', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '첨부 취소', exact: true }).click();
  await expect(page.getByText('사진 업로드 실패', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('1회차 출발', { exact: true })).toBeEnabled();

  await page.unroute('**/api/uses/*/evidence');
  await page.route('**/api/evidence/*/content', async (route) =>
    route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'VALIDATION_FAILED', message: '실제 이미지 형식과 일치하지 않습니다.' },
      }),
    }),
  );
  await page.getByLabel('사진·파일 선택', { exact: true }).setInputFiles('public/icons/icon-192.png');
  await page.getByRole('button', { name: '서버 저장', exact: true }).click();
  await expect(page.locator('#form-errors')).toContainText('실제 이미지 형식과 일치하지 않습니다.');
  await page.getByRole('button', { name: '첨부 취소', exact: true }).click();
  await expect(page.getByText('사진 업로드 실패', { exact: true })).toHaveCount(0);
  const rows = await database.db
    .select()
    .from(vehicleUses)
    .where(eq(vehicleUses.driver_id, scenario.driver.id));
  expect(rows).toHaveLength(1);
  expect((await getUse(scenario.driverCtx, rows[0].id)).evidence).toHaveLength(0);

  await page.getByRole('button', { name: '기기 초안 폐기', exact: true }).click();
  await expect(page.getByRole('alertdialog', { name: '기기 초안 폐기 확인' })).toBeVisible();
  await page.getByRole('button', { name: '계속 작성', exact: true }).click();
  await expect(page.getByLabel('1회차 출발', { exact: true })).toHaveValue('서울 자재 야적장');
  await page.getByRole('button', { name: '기기 초안 폐기', exact: true }).click();
  await page.getByRole('button', { name: '기기 초안 폐기 확인', exact: true }).click();
  await expect(page).toHaveURL(/\/d$/);
  const localCount = await page.evaluate(async (userId) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open(`vehicle-w2-${userId}`, 1);
      request.onsuccess = () => resolve(request.result);
    });
    return new Promise<number>((resolve) => {
      const request = db.transaction('drafts').objectStore('drafts').count();
      request.onsuccess = () => {
        db.close();
        resolve(request.result);
      };
    });
  }, scenario.driverUser.id);
  expect(localCount).toBe(0);
  expect(
    await database.db.select().from(vehicleUses).where(eq(vehicleUses.driver_id, scenario.driver.id)),
  ).toHaveLength(1);
});
