import { open, shot, top, login, BASE } from './lib.mjs';
import { IMG } from './lib.mjs';
const { browser, page } = await open({ mobile: false });
try {
  await login(page, 'site');
  await page.getByRole('link', { name: '검수함 열기' }).waitFor();
  await shot(page, '20-manager-dashboard', { wait: 1500 });
  await page.getByRole('link', { name: '검수함 열기' }).click();
  await page.waitForURL(/\/m\/review/);
  await page.locator('article').first().waitFor();
  await shot(page, '21-review-inbox', { wait: 1500 });
  // 기사가 보완해서 다시 보낸 건(9월 7일)을 자세히 연다.
  await page.locator('article').filter({ hasText: 'B동 뒤 자재' }).getByRole('link', { name: /^U-/ }).first().click();
  await page.getByRole('heading', { name: '비용 검수' }).waitFor();
  await shot(page, '22-use-detail', { wait: 1500 });
  await top(page, page.getByRole('heading', { name: '비용 검수' }), 16);
  await shot(page, '23-cost-review');
  const approveAll = page.getByRole('button', { name: /전체 승인/ });
  if (await approveAll.isEnabled().catch(() => false)) await approveAll.click();
  await page.getByText('검수가 완료되었습니다', { exact: false }).first().waitFor();
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, '24-approved');
  await page.goto(BASE + '/m/review');
  await page.locator('article').first().waitFor();
  await page.waitForTimeout(1200);
  const quick = page.locator('article').filter({ has: page.getByRole('button', { name: '바로 승인' }) }).first();
  const no = await quick.getByRole('link').filter({ hasText: /^U-/ }).first().textContent();
  await quick.getByRole('button', { name: '바로 승인' }).click();
  await page.locator('article').filter({ hasText: no }).getByText('승인됨', { exact: true }).waitFor();
  console.log('quick approved', no);
  await shot(page, '25-quick-approved');
  const all = page.getByRole('button', { name: /문제없는 \d+건 모두 선택/ });
  if (await all.count()) {
    await all.click();
    await page.getByRole('button', { name: /선택 \d+건 승인/ }).waitFor();
    await shot(page, '26-bulk-select');
    await page.getByRole('button', { name: /선택 \d+건 승인/ }).click();
    await page.waitForTimeout(3000);
    await shot(page, '27-bulk-approved');
  } else console.log('no bulk candidates');
} catch (e) {
  await page.screenshot({ path: IMG + 'error.png' });
  console.error('FAIL', e.message.split('\n').slice(0, 8).join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
