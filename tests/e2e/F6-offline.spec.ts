import 'dotenv/config';
import { test, expect, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { createDatabase, defaultDatabaseUrl } from '../../src/server/db/client';
import { setupScenario } from '../helpers/factories';
import { vehicleUses } from '../../src/server/db/schema';
import { getUse, requestFix, updateUse } from '../../src/server/services/uses';

test.use({ viewport: { width: 390, height: 844 } });
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
  await page.getByLabel('1회차 출발', { exact: true }).fill('F6 상차장');
  await page.getByLabel('1회차 도착', { exact: true }).fill('F6 현장');
}
async function useFor(driverId: string) {
  const [use] = await database.db.select().from(vehicleUses).where(eq(vehicleUses.driver_id, driverId));
  return use;
}

test('R7-2 생성 응답 유실 후 첨부 취소·새로고침·편집은 원본 복구 후 PATCH한다', async ({ page }) => {
  const s = await setupScenario(database.db);
  await openForm(page, s.driverUser.login_id);
  let recovered = false;
  let created = false;
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
  await expect(page.getByLabel('1회차 출발', { exact: true })).toBeEnabled();
  await page.reload();
  await page.getByLabel('청구수량', { exact: true }).fill('2');
  await page.getByLabel('1회차 도착', { exact: true }).fill('첨부 취소 후 새 도착지');
  recovered = true;
  await page.getByRole('button', { name: '서버 저장', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '서버 저장(작성중)' })).toBeVisible();
  expect(posts.length).toBeGreaterThanOrEqual(2);
  expect(posts.every((body) => body === posts[0])).toBe(true);
  const use = await getUse(s.driverCtx, (await useFor(s.driver.id)).id);
  expect(use.charge_lines[0].quantity).toBe('2.000');
  expect(use.trips[0].destination).toBe('첨부 취소 후 새 도착지');
  expect(use.evidence).toHaveLength(0);
});

test('R7-3 재전송은 담당자 최신 수량을 표시하고 다시 불러온 뒤에만 제출한다', async ({ page }) => {
  const s = await setupScenario(database.db);
  await openForm(page, s.driverUser.login_id);
  let failing = true;
  await page.route(/\/api\/uses\/[^/]+$/, (route) =>
    failing && route.request().method() === 'GET' ? route.abort('failed') : route.continue(),
  );
  await page.getByRole('button', { name: '담당자에게 제출', exact: true }).click();
  await expect(page.locator('#form-errors')).toBeVisible();
  const saved = await useFor(s.driver.id);
  await updateUse(s.adminCtx, saved.id, { version: saved.version, quantity: '9', notes: '담당자 수정 내용' });
  failing = false;
  await page.getByRole('button', { name: '미전송 다시 보내기', exact: true }).click();
  await expect(page.getByText('다른 수정 내용이 있습니다', { exact: true })).toBeVisible();
  await expect(page.getByText('특이사항: 담당자 수정 내용', { exact: true })).toBeVisible();
  await expect(page.getByText('청구수량: 9.000', { exact: true })).toBeVisible();
  expect((await getUse(s.driverCtx, saved.id)).review_status).toBe('DRAFT');
  await page.getByRole('button', { name: '최신 값으로 불러와 다시 작성', exact: true }).click();
  await page.getByRole('button', { name: '담당자에게 제출', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '담당자에게 제출 완료' })).toBeVisible();
  expect((await getUse(s.driverCtx, saved.id)).charge_lines[0].quantity).toBe('9.000');
});

test('R7-4 제출 응답 재생 후 폼과 내 운행 목록에 최신 보완요청을 표시한다', async ({ page }) => {
  const s = await setupScenario(database.db);
  await openForm(page, s.driverUser.login_id);
  let failing = true;
  await page.route('**/api/uses/*/submit', async (route) => {
    if (!failing) return route.continue();
    await route.fetch();
    await route.abort('failed');
  });
  await page.getByRole('button', { name: '담당자에게 제출', exact: true }).click();
  await expect(page.locator('#form-errors')).toBeVisible();
  const saved = await useFor(s.driver.id);
  await requestFix(s.adminCtx, saved.id, {
    version: saved.version,
    fix_items: [{ target: 'trip:1.destination', message: '최신 도착지 보완요청' }],
  });
  failing = false;
  await page.getByRole('button', { name: '미전송 다시 보내기', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '보완요청' })).toBeVisible();
  await expect(page.getByRole('button', { name: '최신 도착지 보완요청 →', exact: true })).toBeVisible();
  await page.goto('/d');
  await expect(page.getByText('보완요청', { exact: true }).first()).toBeVisible();
  expect((await getUse(s.driverCtx, saved.id)).current_revision_no).toBe(1);
});
