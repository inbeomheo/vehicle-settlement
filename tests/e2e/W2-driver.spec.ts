import 'dotenv/config';
import { test, expect, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { createDatabase, defaultDatabaseUrl } from '../../src/server/db/client';
import { setupScenario } from '../helpers/factories';
import { vehicleUses } from '../../src/server/db/schema';
import { getUse, requestFix } from '../../src/server/services/uses';
test.use({ viewport: { width: 390, height: 844 } });
test.setTimeout(120000);
const database = createDatabase(defaultDatabaseUrl());
test.afterAll(async () => {
  await database.pool.end();
});
async function login(page: Page, loginId: string) {
  await page.goto('/login');
  await page.getByLabel('아이디', { exact: true }).fill(loginId);
  await page.getByLabel('비밀번호', { exact: true }).fill('password1234');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page).toHaveURL(/\/d$/);
  await expect(page.getByRole('heading', { name: '내 운행', exact: true })).toBeVisible();
}
async function newForm(page: Page) {
  await page.goto('/d/new');
  await expect(page.getByLabel('1회차 출발', { exact: true })).toBeVisible();
  await page.getByLabel('1회차 출발', { exact: true }).fill('상차장');
  await page.getByLabel('1회차 도착', { exact: true }).fill('현장 1문');
}
test('모바일 5회 운행·사진 실패 재시도·일대 30만원 제출·보완 항목 재제출', async ({ page }) => {
  const s = await setupScenario(database.db, { evidence_policy: 'PHOTO_REQUIRED' });
  await login(page, s.driverUser.login_id);
  await newForm(page);
  for (let i = 2; i <= 5; i++) {
    await page.getByRole('button', { name: '+ 운행 추가', exact: true }).click();
    await page.getByLabel(`${i}회차 출발`, { exact: true }).fill('상차장');
    await page.getByLabel(`${i}회차 도착`, { exact: true }).fill(`현장 ${i}문`);
  }
  await expect(page.getByText('기본운임 300,000원', { exact: true })).toBeVisible();
  await expect(page.getByLabel('청구수량', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('고객 (선택)')).toHaveCount(0);
  await page.getByLabel('사진·파일 선택', { exact: true }).setInputFiles('public/icons/icon-512.png');
  await expect(page.getByText('사진 업로드 대기', { exact: true })).toBeVisible();
  let fail = true;
  let creates = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/uses') creates++;
  });
  await page.route('**/api/evidence/*/content', async (route) => {
    if (fail)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UPLOAD_FAILED', message: '테스트 업로드 실패' } }),
      });
    else await route.continue();
  });
  await page.getByRole('button', { name: '담당자에게 제출', exact: true }).click();
  await expect(page.getByText('사진 업로드 실패', { exact: true })).toBeVisible();
  await expect(page.getByText('서버 저장(작성중) · 전송 처리 중', { exact: true })).toBeVisible();
  let rows = await database.db.select().from(vehicleUses).where(eq(vehicleUses.driver_id, s.driver.id));
  expect(rows).toHaveLength(1);
  expect(rows[0].review_status).toBe('DRAFT');
  fail = false;
  await page.getByRole('button', { name: '사진 다시 보내기', exact: true }).click();
  await expect(page.getByText('담당자에게 제출 완료', { exact: true })).toBeVisible();
  expect(creates).toBe(1);
  let use = await getUse(s.driverCtx, rows[0].id);
  expect(use.evidence).toHaveLength(1);
  expect(use.trips).toHaveLength(5);
  expect(use.charge_lines[0].computed_amount).toBe(300000);
  await page.goto('/d');
  await expect(page.getByText('제출 완료', { exact: true })).toBeVisible();
  use = await requestFix(s.adminCtx, use.id, {
    version: use.version,
    fix_items: [{ target: 'trip:2.destination', message: '2회차 하차장을 보완하세요' }],
  });
  await page.goto(`/d/uses/${use.id}`);
  await expect(page.getByLabel('2회차 도착', { exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '2회차 하차장을 보완하세요 →' }).click();
  await expect(page.getByLabel('2회차 도착', { exact: true })).toBeFocused();
  await page.getByLabel('2회차 도착', { exact: true }).fill('동쪽 출입구');
  await page.getByRole('button', { name: '보완 후 재제출', exact: true }).click();
  await expect(page.getByText('담당자에게 제출 완료', { exact: true })).toBeVisible();
  rows = await database.db.select().from(vehicleUses).where(eq(vehicleUses.driver_id, s.driver.id));
  expect(rows).toHaveLength(1);
  expect(rows[0].review_status).toBe('SUBMITTED');
  await page.screenshot({ path: 'test-results/W2-submitted-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('아이디', { exact: true }).fill(s.admin.login_id);
  await page.getByLabel('비밀번호', { exact: true }).fill('password1234');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page).toHaveURL(/\/m$/);
  await page.goto('/m/uses/new');
  await page.getByLabel('실제 기사', { exact: true }).selectOption(s.driver.id);
  await page.getByLabel('현장', { exact: true }).selectOption(s.project.id);
  await page.getByLabel('1회차 출발', { exact: true }).fill('대리 입력 상차');
  await page.getByLabel('1회차 도착', { exact: true }).fill('대리 입력 하차');
  await page.getByRole('button', { name: '서버 저장', exact: true }).click();
  await expect(page).toHaveURL(/\/m\/uses\/[a-f0-9-]+$/);
  const proxyId = new URL(page.url()).pathname.split('/').pop()!;
  const proxy = await getUse(s.adminCtx, proxyId);
  expect(proxy.entered_as).toBe('PROXY');
  expect(proxy.created_by_user_id).toBe(s.admin.id);
  expect(proxy.driver_id).toBe(s.driver.id);
  await page.request.post('/api/auth/logout');
  await login(page, s.driverUser.login_id);
  await page.goto(`/d/uses/${proxyId}`);
  await expect(page.getByText(/작성자:.*실제 기사:.*대리 입력/)).toBeVisible();
  await page.getByRole('button', { name: '내용 확인', exact: true }).click();
  await expect(page.getByText('기사가 내용을 확인했습니다.')).toBeVisible();
});
test('오프라인 작성·앱 재실행 복구·자동 전송 1건·로그아웃 계정 격리', async ({ page, context }) => {
  const s = await setupScenario(database.db, { evidence_policy: 'PHOTO_OR_ALTERNATIVE' });
  await login(page, s.driverUser.login_id);
  await newForm(page);
  await expect(page.getByText('휴대폰에 임시저장됨', { exact: true })).toBeVisible();
  const controlled = await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    return !!navigator.serviceWorker.controller;
  });
  // Activation can finish during the /d → /d/new navigation, before that new
  // document is claimed. A navigation after readiness acquires the active worker.
  if (!controlled) await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.getByLabel('1회차 출발', { exact: true })).toHaveValue('상차장');
  await context.setOffline(true);
  await page.getByLabel('운반 내용', { exact: true }).fill('오프라인 자재 운반');
  await page.getByLabel('전표번호 (대체증빙)').fill('SLIP-OFFLINE-1');
  await page.getByRole('button', { name: '전표번호 첨부', exact: true }).click();
  await expect(page.getByText(/휴대폰에 임시저장됨/)).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('운반 내용', { exact: true })).toHaveValue('오프라인 자재 운반');
  await expect(page.getByText('SLIP-OFFLINE-1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '담당자에게 제출', exact: true }).click();
  await expect(page.getByRole('button', { name: '미전송 다시 보내기', exact: true })).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText('담당자에게 제출 완료', { exact: true })).toBeVisible({ timeout: 30000 });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  const rows = await database.db.select().from(vehicleUses).where(eq(vehicleUses.driver_id, s.driver.id));
  expect(rows).toHaveLength(1);
  expect(rows[0].review_status).toBe('SUBMITTED');
  // New unsent data must not appear for another user on the same phone.
  await newForm(page);
  await page.getByLabel('운반 내용', { exact: true }).fill('첫 계정 전용 초안');
  await expect(page.getByText('휴대폰에 임시저장됨', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  const other = await setupScenario(database.db);
  await login(page, other.driverUser.login_id);
  await expect(page.getByText('이 휴대폰에 보관된 운행')).toHaveCount(0);
  await page.goto('/d/new');
  await expect(page.getByLabel('운반 내용', { exact: true })).toHaveValue('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/W2-form-mobile.png', fullPage: true });
});
