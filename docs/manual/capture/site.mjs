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
  await page.getByRole('button', { name: '전체', exact: true }).click();
  await shot(page, '21c-review-all');
  await page.goto(BASE + '/m/approvals?from=2026-09-01&to=2026-09-30');
  await page.waitForLoadState('networkidle');
  await page.locator('summary').filter({ hasText: '필터 ·' }).click();
  await shot(page, '20b-approvals');
  await page.goto(BASE + '/m/review?reviewer_scope=all');
  await page.waitForLoadState('networkidle');
  // 기사가 보완해서 다시 보낸 건(9월 7일)을 자세히 연다.
  await page
    .locator('article')
    .filter({ hasText: 'B동 뒤 자재' })
    .getByRole('link', { name: /^U-/ })
    .first()
    .click();
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
  const reportHref = await page.getByRole('link', { name: '보고서 PDF', exact: true }).getAttribute('href');
  const report = await page.request.get(new URL(reportHref, BASE).toString());
  if (!report.ok()) throw new Error('보고서 PDF 생성 실패');
  const { writeFileSync, copyFileSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  writeFileSync(IMG + '../use-report.pdf', await report.body());
  execFileSync('pdftoppm', [
    '-png',
    '-r',
    '110',
    '-f',
    '1',
    '-l',
    '1',
    '-singlefile',
    IMG + '../use-report.pdf',
    IMG + '24b-use-report',
  ]);
  copyFileSync(
    IMG + '24b-use-report.png',
    new URL('../../../public/manual/24b-use-report.png', import.meta.url),
  );
  // 기사가 계약과 다른 금액을 넣은 건: 주황 표시 → 열어서 확인
  await page.goto(BASE + '/m/review');
  await page.locator('article').first().waitFor();
  await page.waitForTimeout(1200);
  const differ = page.locator('article').filter({ hasText: '330,000' }).first();
  await differ.scrollIntoViewIfNeeded();
  await shot(page, '21b-inbox-differ');
  await differ.getByRole('link', { name: /^U-/ }).first().click();
  await page.getByRole('heading', { name: '비용 검수' }).waitFor();
  await top(page, page.getByRole('heading', { name: '비용 검수' }), 16);
  await shot(page, '23b-cost-differ', { wait: 1200 });
  await page.goto(BASE + '/m/review');
  await page.locator('article').first().waitFor();
  await page.waitForTimeout(1200);
  const quick = page
    .locator('article')
    .filter({ has: page.getByRole('button', { name: '바로 승인' }) })
    .first();
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
