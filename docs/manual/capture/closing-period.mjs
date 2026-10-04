import { open, shot, login, BASE } from './lib.mjs';
if (BASE !== 'http://localhost:3202') throw new Error('마감 기간 캡처는 로컬 3202에서만 실행하세요.');
const { browser, page } = await open({ mobile: false });
try {
  await login(page, 'settlement');
  await page.goto(`${BASE}/m/summary`);
  await page.getByRole('button', { name: /^이번 마감 \(/ }).click();
  await page.getByRole('button', { name: '엑셀로 받기', exact: true }).waitFor();
  await page.getByLabel('집계 요약').waitFor();
  await shot(page, '28-summary');
} finally {
  await browser.close();
}
