import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, login_id: string) {
  const response = await page.request.post('/api/auth/login', {
    data: { login_id, password: login_id === 'admin' ? 'admin1234' : 'demo1234' },
  });
  expect(response.ok()).toBe(true);
  await page.goto('/m');
}

test('11: 역할별 메뉴 및 직접 URL의 서버 권한 가드', async ({ page }) => {
  await login(page, 'site');
  const menu = page.getByRole('navigation', { name: '주 메뉴' });
  for (const label of ['대시보드', '검수함', '차량 사용대장', '대리 입력', '변경 이력']) {
    await expect(menu.getByRole('link', { name: label, exact: true })).toBeVisible();
  }
  for (const label of ['월 정산', '지급 관리', '엑셀 가져오기', '기준정보', '사용자 관리']) {
    await expect(menu.getByRole('link', { name: label, exact: true })).toHaveCount(0);
  }
  for (const route of [
    '/m/statements',
    '/m/payments',
    '/m/import',
    '/m/master',
    '/m/master/projects',
    '/m/users',
  ]) {
    await page.goto(route);
    await expect(page).toHaveURL('/m');
  }
  await login(page, 'settlement');
  for (const label of ['월 정산', '지급 관리', '엑셀 가져오기']) {
    await expect(menu.getByRole('link', { name: label, exact: true })).toBeVisible();
  }
  for (const label of ['기준정보', '사용자 관리']) {
    await expect(menu.getByRole('link', { name: label, exact: true })).toHaveCount(0);
  }
  await page.goto('/m/users');
  await expect(page).toHaveURL('/m');
  await login(page, 'admin');
  await expect(menu.getByRole('link')).toHaveCount(10);
  await page.goto('/m/users');
  await expect(page.getByRole('heading', { name: '사용자 관리' })).toBeVisible();
});

test('9: 지급 관리 URL의 state와 기존 status 모두 필터에 반영한다', async ({ page }) => {
  await login(page, 'settlement');
  await page.goto('/m/payments?status=UNPAID');
  await expect(page.getByLabel('조회 상태')).toHaveValue('UNPAID');
  await page.goto('/m/payments?state=PAID');
  await expect(page.getByLabel('조회 상태')).toHaveValue('PAID');
});
