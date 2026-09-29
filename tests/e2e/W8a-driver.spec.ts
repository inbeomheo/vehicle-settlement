import { expect, test, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../../src/server/db/client';
import { rateAgreements, vehicleUses } from '../../src/server/db/schema';
import { setupScenario } from '../helpers/factories';
import { approveUse, createUse, getUse, submitUse } from '../../src/server/services/uses';
import { createStatement, confirmStatement } from '../../src/server/services/statements';

const database = createDatabase(process.env.DATABASE_URL!);
test.use({ viewport: { width: 390, height: 844 }, actionTimeout: 15000 });
test.setTimeout(120000);
test.afterAll(async () => database.pool.end());
async function login(page: Page, login_id: string, path = '/d/new') {
  await page.request.post('/api/auth/login', { data: { login_id, password: 'password1234' } });
  await page.goto(path);
}
async function fillTrip(page: Page, seq = 1) {
  await page.getByLabel(`${seq}회차 출발`, { exact: true }).fill('서울 상차장');
  await page.getByLabel(`${seq}회차 도착`, { exact: true }).fill('인천 현장');
  await page.getByLabel('운반 내용', { exact: true }).fill('자재');
}
async function approved(s: Awaited<ReturnType<typeof setupScenario>>) {
  let use = await createUse(s.driverCtx, {
    ...s.input,
    trips: [{ seq: 1, origin: '서울 상차장', destination: '인천 현장', cargo_desc: '자재' }],
  });
  use = await submitUse(s.driverCtx, use.id, { version: use.version });
  return approveUse(s.adminCtx, use.id, { version: use.version });
}

test('확정 상세는 읽기 전용, 승인 건은 확인 후 편집·재승인, 서버 잠금 경합 안내', async ({ page }) => {
  const s = await setupScenario(database.db);
  let use = await approved(s);
  await login(page, s.driverUser.login_id, `/d/uses/${use.id}`);
  await expect(page.locator('input,select,textarea')).toHaveCount(0);
  await page.getByRole('button', { name: '수정하기', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText(
    '수정하면 승인이 해제되고 다시 검수를 받아야 합니다',
  );
  await page.getByRole('button', { name: '확인 후 수정' }).click();
  await page.getByLabel('운반 내용', { exact: true }).fill('기사 수정');
  await page.getByRole('button', { name: '서버 저장', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('서버 저장(작성중)');
  expect((await getUse(s.driverCtx, use.id)).review_status).toBe('DRAFT');
  use = await getUse(s.driverCtx, use.id);
  use = await submitUse(s.driverCtx, use.id, { version: use.version });
  use = await approveUse(s.adminCtx, use.id, { version: use.version });
  await page.reload();
  await page.getByRole('button', { name: '수정하기', exact: true }).click();
  await page.getByRole('button', { name: '확인 후 수정' }).click();
  const statement = await createStatement(s.adminCtx, {
    client_request_id: crypto.randomUUID(),
    direction: 'PAYABLE',
    counterparty_id: s.payee.id,
    period_start: '2026-09-01',
    period_end: '2026-09-30',
    items: [{ charge_line_id: use.charge_lines[0].id }],
  });
  await confirmStatement(s.adminCtx, statement.id, {
    confirmation_token: statement.confirmation_token!,
    version: statement.version,
  });
  await page.getByLabel('운반 내용', { exact: true }).fill('확정 직후 수정 시도');
  await page.getByRole('button', { name: '서버 저장', exact: true }).click();
  await expect(page.locator('#form-errors')).toContainText('담당자에게 문의하세요');
  await expect(page.getByText('휴대폰에 저장 중…', { exact: true })).toHaveCount(0);
  await expect(page.locator('input,select,textarea')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '서버 저장', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '담당자에게 제출', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByText('정산 확정된 운행입니다. 수정이 필요하면 담당자에게 문의하세요', { exact: true }).last(),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '수정하기', exact: true })).toHaveCount(0);
});

test('이전 운행은 서버 생성 없이 기기 초안 복사, 서버 작성중 취소 확인', async ({ page }) => {
  const s = await setupScenario(database.db);
  const use = await approved(s);
  await login(page, s.driverUser.login_id, `/d/uses/${use.id}`);
  let writes = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/api\/uses(?:$|\/.*\/copy)/.test(new URL(request.url()).pathname))
      writes++;
  });
  await page.getByRole('button', { name: '이전 운행 복사', exact: true }).click();
  await expect(page).toHaveURL(/\/d\/new\?draft=/);
  await expect(page.getByLabel('1회차 출발', { exact: true })).toHaveValue('서울 상차장');
  await expect(page.getByLabel('사용일', { exact: true })).toHaveValue(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()),
  );
  expect(writes).toBe(0);
  expect(
    await database.db.select().from(vehicleUses).where(eq(vehicleUses.driver_id, s.driver.id)),
  ).toHaveLength(1);
  await page.getByRole('button', { name: '서버 저장', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('서버 저장(작성중)');
  const rows = await database.db.select().from(vehicleUses).where(eq(vehicleUses.driver_id, s.driver.id));
  expect(rows).toHaveLength(2);
  const copied = rows.find((row) => row.id !== use.id)!;
  await page.getByRole('button', { name: '작성중 운행 취소', exact: true }).click();
  await expect(page.getByRole('alertdialog', { name: '작성중 운행 취소 확인' })).toBeVisible();
  await page.getByRole('button', { name: '운행 취소 확인', exact: true }).click();
  await expect(page).toHaveURL(/\/d$/);
  expect((await getUse(s.driverCtx, copied.id)).operation_status).toBe('CANCELED');
});

test('증빙 필수 검사는 편집 유지·영역 강조, 서버 SUBMIT_BLOCKED도 입력 오류로 복귀', async ({ page }) => {
  const s = await setupScenario(database.db, { evidence_policy: 'PHOTO_REQUIRED' });
  await login(page, s.driverUser.login_id);
  await fillTrip(page);
  await page.getByRole('button', { name: '담당자에게 제출', exact: true }).click();
  const evidence = page.locator('[data-fix-target="evidence"]');
  await expect(evidence.getByRole('alert')).toHaveText('사진·인수증·계근표·확인서 중 1개 이상을 등록하세요.');
  await expect(page.getByLabel('1회차 출발', { exact: true })).toBeEnabled();
  expect(
    await database.db.select().from(vehicleUses).where(eq(vehicleUses.driver_id, s.driver.id)),
  ).toHaveLength(0);
  await page.getByLabel('사진·파일 선택', { exact: true }).setInputFiles('public/icons/icon-192.png');
  await page.route('**/api/uses/*/submit', (route) =>
    route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'SUBMIT_BLOCKED', message: '변경된 현장 정책에 맞는 증빙을 첨부하세요' },
      }),
    }),
  );
  await page.getByRole('button', { name: '담당자에게 제출', exact: true }).click();
  await expect(page.locator('#form-errors')).toContainText('변경된 현장 정책');
  await expect(page.getByLabel('1회차 출발', { exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '미전송 다시 보내기' })).toHaveCount(0);
  await page.goto('/d');
  await expect(page.getByText('기기 미전송').locator('..')).toContainText('0건');
});

test('390·360·1440px 5회차 접기·직전 복사·재정렬·필드 크기와 현재 탭', async ({ page }, testInfo) => {
  const s = await setupScenario(database.db);
  await login(page, s.driverUser.login_id);
  await fillTrip(page);
  for (let seq = 2; seq <= 5; seq++) {
    await page.getByRole('button', { name: '직전 회차 복사', exact: true }).click();
    await expect(page.getByLabel(`${seq}회차 출발`, { exact: true })).toHaveValue('서울 상차장');
    await expect(page.getByRole('button', { name: `${seq - 1}회차 위로`, exact: true })).toBeHidden();
  }
  await expect(page.getByLabel('1회차 도착', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: '1회차 펼치기', exact: true }).click();
  await page.getByLabel('1회차 도착', { exact: true }).fill('변경된 현장');
  await page.getByRole('button', { name: '1회차 아래로', exact: true }).click();
  await expect(page.getByLabel('2회차 도착', { exact: true })).toHaveValue('변경된 현장');
  await page.getByRole('button', { name: '2회차 입력 완료', exact: true }).click();
  const measurements = [];
  for (const width of [390, 360, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const compact = await page.evaluate(() => document.documentElement.scrollHeight);
    while (await page.getByRole('button', { name: /회차 펼치기$/ }).count())
      await page
        .getByRole('button', { name: /회차 펼치기$/ })
        .first()
        .click();
    const expanded = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(compact).toBeLessThan(expanded * (width >= 1000 ? 0.85 : 0.75));
    for (let seq = 1; seq <= 4; seq++)
      await page.getByRole('button', { name: `${seq}회차 입력 완료`, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    measurements.push({ width, compact, expanded });
    const bad = await page
      .locator('main input:not([type=file]),main select,main textarea')
      .evaluateAll((elements) =>
        elements
          .filter(
            (e) =>
              e.getBoundingClientRect().height > 0 &&
              (parseFloat(getComputedStyle(e).fontSize) < 16 || e.getBoundingClientRect().height < 44),
          )
          .map((e) => e.outerHTML),
      );
    expect(bad).toEqual([]);
  }
  await testInfo.attach('5회차 높이', {
    body: JSON.stringify(measurements),
    contentType: 'application/json',
  });
  await expect(
    page.getByRole('navigation', { name: '주 메뉴' }).getByRole('link', { name: '운행 등록' }),
  ).toHaveAttribute('aria-current', 'page');
  expect(await page.locator('nav[aria-label="주 메뉴"] svg').count()).toBe(3);
});

test('PER_TRIP 청구수량 안내·필수 검사', async ({ page }) => {
  const s = await setupScenario(database.db);
  await database.db
    .update(rateAgreements)
    .set({ billing_unit: 'PER_TRIP', unit_price: 100000 })
    .where(eq(rateAgreements.id, s.rate.id));
  await login(page, s.driverUser.login_id);
  await fillTrip(page);
  await expect(page.getByLabel('과금 단위', { exact: true })).toHaveValue('PER_TRIP');
  await expect(page.getByLabel('청구수량', { exact: true })).toHaveValue('1');
  await expect(page.getByText('운행 1회 기준 자동 입력, 수정 가능', { exact: true })).toBeVisible();
  await page.getByLabel('청구수량', { exact: true }).fill('');
  await expect(page.getByText('청구 수량을 입력하세요', { exact: true })).toBeVisible();
  await expect(page.getByText('기본운임 단가 미확정', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '담당자에게 제출', exact: true }).click();
  await expect(page.locator('#form-errors')).toContainText('청구 수량을 입력하세요');
  await expect(page.getByLabel('청구수량', { exact: true })).toBeEnabled();
  await page.getByLabel('청구수량', { exact: true }).fill('5');
  await expect(page.getByText('기본운임 500,000원', { exact: true })).toBeVisible();
});

test('홈 API 500 재시도, 401일 때만 로그인', async ({ page }) => {
  const s = await setupScenario(database.db);
  let status = 500;
  await page.route('**/api/uses?**', (route) =>
    status
      ? route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: status === 401 ? 'UNAUTHENTICATED' : 'INTERNAL_ERROR', message: '서버 오류' },
          }),
        })
      : route.continue(),
  );
  await login(page, s.driverUser.login_id, '/d');
  await expect(page.locator('main').getByRole('alert')).toContainText('잠시 후 다시 시도');
  await expect(page.getByRole('link', { name: '로그인', exact: true })).toHaveCount(0);
  status = 0;
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(page.getByRole('heading', { name: '내 운행', exact: true })).toBeVisible();
  status = 401;
  await page.reload();
  await expect(page.getByRole('link', { name: '로그인', exact: true })).toBeVisible();
});

test('오프라인 제출 대기·로그아웃 N건 확인 취소/승인·정적 로그인 안내', async ({ page, context }) => {
  const s = await setupScenario(database.db);
  await login(page, s.driverUser.login_id);
  await fillTrip(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.getByRole('button', { name: '담당자에게 제출', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('제출 대기 · 연결되면 자동 제출');
  const firstDialog = page.waitForEvent('dialog');
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  const dismissed = await firstDialog;
  expect(dismissed.message()).toBe('전송되지 않은 1건이 있습니다. 로그아웃하면 이 기기에서 볼 수 없습니다');
  await dismissed.dismiss();
  await expect(page.getByRole('button', { name: '로그아웃', exact: true })).toBeEnabled();
  await expect(page).toHaveURL(/\/d\/new\?draft=[a-f0-9-]+$/);
  const secondDialog = page.waitForEvent('dialog');
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await (await secondDialog).accept();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: '인터넷 연결 후 로그인해 주세요' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('vehicle-active-user'))).toBeNull();
  await context.setOffline(false);
});

test('내 정산 검수 전 표시와 날짜 16px·44px', async ({ page }) => {
  const s = await setupScenario(database.db);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const use = await createUse(s.driverCtx, { ...s.input, use_date: date });
  await login(page, s.driverUser.login_id, '/d/settlements');
  const card = page.locator('article').filter({ hasText: use.use_no });
  await expect(card).toContainText('인정 공급가 검수 전');
  await expect(card).not.toContainText('인정 공급가 0원');
  for (const field of await page.locator('input[type=date]').all()) {
    expect(
      await field.evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
    ).toBeGreaterThanOrEqual(16);
    expect((await field.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await expect(page.getByRole('link', { name: '내 정산', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
});
