import { expect, test } from '@playwright/test';
import { createDatabase } from '../../src/server/db/client';
import { setupScenario } from '../helpers/factories';

async function prepare() {
  const database = createDatabase(process.env.DATABASE_URL!);
  try {
    const s = await setupScenario(database.db);
    return { admin: s.adminCtx.user.login_id, driver: s.driverCtx.user.login_id };
  } finally {
    await database.pool.end();
  }
}
test('1440 집계 마감 빠른 선택은 URL·상세·두 엑셀에 동일 기간을 전달한다', async ({ page }) => {
  const s = await prepare();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.request.post('/api/auth/login', { data: { login_id: s.admin, password: 'password1234' } });
  await page.route('**/api/closing-period', (route) =>
    route.fulfill({ json: { data: { today: '2026-10-04', closing_start_day: 19 } } }),
  );
  await page.goto('/m/summary?from=2026-08-01&to=2026-08-31&detail=project&include=all');
  await page.getByRole('button', { name: '이번 마감 (9/19~10/18)', exact: true }).click();
  await expect(page).toHaveURL(/from=2026-09-19&to=2026-10-18/);
  await expect(page).toHaveURL(/detail=project/);
  for (const [name, file] of [
    ['엑셀로 받기', 'export'],
    ['거래명세표 엑셀', 'trade'],
  ]) {
    const response = page.waitForResponse((r) => r.url().includes(`/api/summary/${file}.xlsx?`));
    await page.getByRole('button', { name, exact: true }).first().click();
    const result = await response;
    expect(result.status()).toBe(200);
    expect(new URL(result.url()).searchParams.get('from')).toBe('2026-09-19');
    expect(new URL(result.url()).searchParams.get('to')).toBe('2026-10-18');
  }
  await page.getByRole('button', { name: '지난 마감 (8/19~9/18)' }).click();
  await expect(page).toHaveURL(/from=2026-08-19&to=2026-09-18/);
  await page.goBack();
  await expect(page.getByLabel('시작일', { exact: true })).toHaveValue('2026-09-19');
});
test('360px 아주 큰 글자 기사 정산의 기본 마감·빠른 버튼·날짜 입력은 넘치지 않는다', async ({
  page,
}, info) => {
  const s = await prepare();
  await page.setViewportSize({ width: 360, height: 900 });
  await page.request.post('/api/auth/login', { data: { login_id: s.driver, password: 'password1234' } });
  await page.route('**/api/closing-period', (route) =>
    route.fulfill({ json: { data: { today: '2026-10-04', closing_start_day: 19 } } }),
  );
  await page.goto('/d/settlements');
  await expect(page.getByRole('button', { name: '이번 마감 (9/19~10/18)' })).toBeVisible();
  await page.getByRole('radio', { name: '글자 아주 크게' }).click();
  await page.getByRole('button', { name: '지난 마감 (8/19~9/18)' }).click();
  await expect(page).toHaveURL(/from=2026-08-19&to=2026-09-18/);
  await page.getByRole('button', { name: '기간 직접 고르기' }).click();
  await expect(page.getByLabel('시작일', { exact: true })).toHaveValue('2026-08-19');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('driver-period-360.png'), fullPage: true });
});

test('회사 마감일 저장을 집계·새 명세·운행 결재·대장·기사 화면에서 함께 사용한다', async ({ page }) => {
  const s = await prepare();
  await page.request.post('/api/auth/login', { data: { login_id: s.admin, password: 'password1234' } });
  const companyResponse = await page.request.get('/api/admin/company');
  const company = (await companyResponse.json()).data[0];
  try {
    await page.goto('/m/master/company');
    await page.getByRole('button', { name: '회사 정보 수정', exact: true }).click();
    await page.getByLabel('마감 시작일 (1~28일, 1일은 달력 월)').selectOption('1');
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await expect(page.getByText('저장했습니다.', { exact: true })).toBeVisible();
    const settings = (await (await page.request.get('/api/closing-period')).json()).data;
    expect(settings.closing_start_day).toBe(1);
    const { closingPeriod, closingPeriodLabel } = await import('../../src/shared/closing-period');
    const expected = closingPeriod(settings.today, 1);
    const label = closingPeriodLabel(settings.today, 1);
    await page.goto('/m/summary');
    await expect(page.getByLabel('시작일', { exact: true })).toHaveValue(expected.from);
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
    await page.goto('/m/statements');
    await page.getByRole('button', { name: '새 정산', exact: true }).click();
    await expect(page.getByLabel('기간 시작', { exact: true })).toHaveValue(expected.from);
    await expect(page.getByLabel('기간 종료', { exact: true })).toHaveValue(expected.to);
    await page.goto('/m/approvals');
    await page.locator('summary').filter({ hasText: '필터 ·' }).click();
    await expect(page.getByLabel('운송 시작일')).toHaveValue(settings.today);
    await page.getByRole('button', { name: label, exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`from=${expected.from}&to=${expected.to}`));
    await page.goto('/m/ledger');
    await expect(page.getByLabel('사용일 시작')).toHaveValue('');
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page.getByLabel('사용일 시작')).toHaveValue(expected.from);
    await page.request.post('/api/auth/logout', { headers: { 'idempotency-key': crypto.randomUUID() } });
    await page.request.post('/api/auth/login', { data: { login_id: s.driver, password: 'password1234' } });
    await page.goto('/d/settlements');
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
  } finally {
    await page.request.post('/api/auth/logout', { headers: { 'idempotency-key': crypto.randomUUID() } });
    await page.request.post('/api/auth/login', { data: { login_id: s.admin, password: 'password1234' } });
    await page.request.patch(`/api/admin/company/${company.id}`, {
      headers: { 'idempotency-key': crypto.randomUUID() },
      data: { closing_start_day: company.closing_start_day },
    });
  }
});

test('설정 조회 실패에는 임의의 월을 조회하지 않고 재시도 후 이번 마감을 기본으로 쓴다', async ({ page }) => {
  const s = await prepare();
  await page.request.post('/api/auth/login', { data: { login_id: s.admin, password: 'password1234' } });
  let fail = true;
  let summaryRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/summary?')) summaryRequests++;
  });
  await page.route('**/api/closing-period', (route) =>
    route.fulfill(
      fail
        ? {
            status: 503,
            json: { error: { message: '마감 설정을 불러오지 못했습니다.' } },
          }
        : { json: { data: { today: '2026-10-04', closing_start_day: 19 } } },
    ),
  );
  await page.goto('/m/summary');
  await expect(page.locator('main').getByRole('alert')).toContainText('마감 설정을 불러오지 못했습니다.');
  expect(summaryRequests).toBe(0);
  fail = false;
  await page.getByRole('button', { name: '마감 기간 다시 불러오기' }).click();
  await expect(page.getByLabel('시작일', { exact: true })).toHaveValue('2026-09-19');
  await expect(page.getByLabel('종료일', { exact: true })).toHaveValue('2026-10-18');
  await page.goto('/m/statements');
  await page.getByRole('button', { name: '새 정산', exact: true }).click();
  await expect(page.getByLabel('기간 시작', { exact: true })).toHaveValue('2026-09-19');
  await expect(page.getByLabel('기간 종료', { exact: true })).toHaveValue('2026-10-18');
  await page.getByRole('button', { name: '지난 마감 (8/19~9/18)' }).click();
  await expect(page.getByLabel('기간 시작', { exact: true })).toHaveValue('2026-08-19');
  await expect(page.getByLabel('기간 종료', { exact: true })).toHaveValue('2026-09-18');
});
