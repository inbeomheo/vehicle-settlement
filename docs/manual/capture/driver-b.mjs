import { open, shot, top, login, BASE } from './lib.mjs';
import { IMG } from './lib.mjs';
const { browser, page } = await open();
try {
  await login(page, 'driver1');
  await page.getByRole('heading', { name: '내 운행' }).waitFor();
  const card = page.locator('a, section, div').filter({ hasText: '보완 요청' }).getByRole('link', { name: /고치기/ }).first();
  await card.click();
  await page.waitForURL(/\/d\/uses\//);
  await page.getByRole('button', { name: '고쳐서 다시 보내기', exact: true }).waitFor();
  await shot(page, '12-fix-request', { wait: 1500 });
  const fixLink = page.getByRole('button', { name: /하차 위치/ }).or(page.getByRole('link', { name: /하차 위치/ })).first();
  await fixLink.click();
  await page.waitForTimeout(900);
  const focused = page.locator(':focus');
  console.log('focused', await focused.evaluate((el) => `${el.tagName} ${el.getAttribute('aria-label') ?? el.id} = ${el.value}`));
  await shot(page, '13-fix-jump');
  await focused.fill('서울 현장 B동 뒤 자재 하치장');
  await page.getByRole('button', { name: '고쳐서 다시 보내기', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: '이대로 보낼까요?' });
  await sheet.waitFor();
  await sheet.getByRole('button', { name: '보내기', exact: true }).click();
  await page.getByRole('heading', { name: '보냈습니다' }).waitFor({ timeout: 60000 });
  await shot(page, '14-fix-resent', { wait: 1200 });
  await page.goto(BASE + '/d/settlements?month=2026-09');
  await page.getByRole('heading', { name: '9월 운행' }).waitFor();
  await shot(page, '15-my-settlement', { wait: 1500 });
  const views = page.getByRole('group', { name: '운행 보기' });
  await views.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 80));
  await page.locator('details.group summary').first().click();
  await shot(page, '17-settle-projects');
  await page.getByRole('button', { name: '날짜별', exact: true }).click();
  await views.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 80));
  await shot(page, '18-settle-dates');
  await page.goto(BASE + '/d/account');
  await page.getByLabel('현재 비밀번호').waitFor();
  await shot(page, '19-password-change');
  await page.goto(BASE + '/d');
  await page.getByRole('heading', { name: '내 운행' }).waitFor();
  await page.getByRole('radio', { name: '글자 아주 크게' }).click();
  await shot(page, '16-text-xlarge', { wait: 1200 });
  await page.getByRole('radio', { name: '글자 크게' }).click();
} catch (e) {
  await page.screenshot({ path: IMG + 'error.png' });
  console.error('FAIL', e.message.split('\n').slice(0, 8).join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
