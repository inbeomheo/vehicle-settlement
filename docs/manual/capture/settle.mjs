import { open, shot, top, login, BASE, IMG } from './lib.mjs';
import { execFileSync } from 'node:child_process';
const { browser, page } = await open({ mobile: false });
try {
  await login(page, 'settlement');
  await page.getByRole('link', { name: '월 정산', exact: true }).click();
  await page.waitForURL(/\/m\/statements/);
  await page.getByRole('button', { name: '새 정산', exact: true }).waitFor();
  await shot(page, '30-statements', { wait: 1500 });
  await page.goto(BASE + '/m/summary?view=projects');
  await page.getByRole('button', { name: '한눈에 표' }).waitFor();
  await shot(page, '28-summary', { wait: 2000 });
  await page.getByRole('button', { name: '한눈에 표' }).click();
  await shot(page, '29-summary-table', { wait: 1200 });
  await page.goto(BASE + '/m/statements');
  await page.getByRole('button', { name: '새 정산', exact: true }).waitFor();
  await page.getByRole('button', { name: '새 정산', exact: true }).click();
  const party = page.getByLabel('거래처', { exact: true });
  await party.waitFor();
  const han = await party.locator('option').filter({ hasText: '한길' }).first().getAttribute('value');
  await party.selectOption(han);
  await page.getByRole('button', { name: '당월', exact: true }).click();
  await page.getByLabel('지급 예정일', { exact: true }).fill('2026-10-10');
  await page.getByRole('button', { name: '후보 조회' }).click();
  await page.getByRole('button', { name: '초안 만들기' }).waitFor();
  await page.waitForTimeout(1000);
  const rows = page.locator('select[aria-label$="포함 여부"]');
  console.log('candidate rows', await rows.count());
  // 추가비(대기료 등) 한 줄을 보류로 돌린다.
  const waitRow = page.locator('tr, article, li').filter({ hasText: /대기/ }).filter({ has: page.locator('select[aria-label$="포함 여부"]') }).first();
  let held = false;
  if (await waitRow.count()) {
    await waitRow.locator('select[aria-label$="포함 여부"]').selectOption('HELD');
    await waitRow.locator('[aria-label$="보류 사유"]').fill('대기 시간 현장 확인 중, 10월에 정산');
    held = true;
  }
  console.log('held', held);
  await top(page, page.getByRole('heading').filter({ hasText: /후보/ }).first(), 16).catch(() => {});
  await shot(page, '31-candidates');
  await page.getByRole('button', { name: '초안 만들기' }).click();
  await page.waitForURL(/\/m\/statements\/[0-9a-f-]+$/, { timeout: 150000 });
  await page.getByRole('button', { name: '명세 확정', exact: true }).waitFor();
  await shot(page, '32-draft', { wait: 1500 });
  await page.getByRole('button', { name: '명세 확정', exact: true }).click();
  await page.getByRole('button', { name: '확정', exact: true }).waitFor();
  await shot(page, '33-confirm-step');
  await page.getByRole('button', { name: '확정', exact: true }).click();
  await page.getByText(/^PAY-\d{6}-\d+$/).first().waitFor({ timeout: 60000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, '34-confirmed', { wait: 1500 });
  const pdfHref = await page.getByRole('link', { name: 'PDF 다운로드' }).getAttribute('href');
  const pdf = await page.request.get(new URL(pdfHref, BASE).toString());
  const pdfPath = IMG + '../statement.pdf';
  const { writeFileSync } = await import('node:fs');
  writeFileSync(pdfPath, await pdf.body());
  execFileSync('pdftoppm', ['-png', '-r', '80', '-f', '1', '-l', '1', '-singlefile', pdfPath, IMG + '35-pdf-1']);
  console.log('pdf', pdf.status());
  await page.getByLabel('지급일', { exact: true }).fill('2026-09-30');
  await page.getByLabel('참고번호', { exact: true }).fill('국민 0930-0002');
  await page.getByLabel('메모', { exact: true }).fill('9월 2차 지급');
  await top(page, page.getByRole('button', { name: '지급 기록 저장' }), 420);
  await shot(page, '36-payment-form');
  await page.getByRole('button', { name: '지급 기록 저장' }).click();
  await page.getByText('지급 완료', { exact: true }).first().waitFor({ timeout: 60000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, '37-paid', { wait: 1500 });
} catch (e) {
  await page.screenshot({ path: IMG + 'error.png' });
  console.error('FAIL', e.message.split('\n').slice(0, 8).join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
