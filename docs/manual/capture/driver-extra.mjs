import { open, shot, top, login, BASE } from './lib.mjs';
const { browser, context, page } = await open();
try {
  await context.grantPermissions(['notifications'], { origin: BASE });
  await login(page, 'driver1');
  await page.goto(BASE + '/d?from=2026-09-01&to=2026-09-30');
  await page.waitForLoadState('networkidle');
  await top(page, page.getByRole('heading', { name: '내 운행', exact: true }));
  await shot(page, '11b-home-filters');
  await top(page, page.getByRole('region', { name: '알림 설정' }), 300);
  await shot(page, '19b-notifications');
  await page.goto(BASE + '/d/new');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('요금 기준', { exact: true }).selectOption('PER_TRIP');
  await page.getByLabel('이번 운행 금액(원)', { exact: true }).waitFor();
  await page.getByLabel('이번 운행 금액(원)', { exact: true }).fill('150000');
  await top(page, page.getByRole('heading', { name: '요금 확인' }));
  await shot(page, '08c-no-contract');
} finally {
  await browser.close();
}
