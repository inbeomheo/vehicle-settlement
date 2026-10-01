import { open, shot, login, top, BASE } from './lib.mjs';
if (BASE !== 'http://localhost:3196') throw new Error('집계 상세 캡처는 로컬 3196에서만 실행하세요.');
const { browser, page } = await open({ mobile: false });
try {
  await login(page, 'settlement');
  await page.goto(`${BASE}/m/summary?from=2026-09-01&to=2026-09-30`);
  const payee = page.getByLabel('지급처', { exact: true });
  await payee.locator('option').filter({ hasText: '한길' }).waitFor({ state: 'attached' });
  await payee.selectOption({ label: '한길 운송' });
  await page.getByRole('button', { name: '자세히 보기', exact: true }).first().click();
  const detail = page.getByRole('region', { name: '운행 상세', exact: true });
  await detail.getByRole('cell', { name: '승인', exact: true }).first().waitFor();
  await top(page, detail, 16);
  await shot(page, '29b-summary-detail');
  await page.context().clearCookies();
  await login(page, 'admin', 'admin1234');
  await page.goto(`${BASE}/m/drivers`);
  await page.getByRole('table').getByRole('button', { name: '현장 배정', exact: true }).first().waitFor();
  await shot(page, '45-drivers');
} finally {
  await browser.close();
}
