import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../../package.json', import.meta.url));
export const { chromium } = require('@playwright/test');
export const BASE = process.env.BASE ?? 'https://vehicle-settlement.vercel.app';
export const IMG = process.env.IMG ?? fileURLToPath(new URL('../img/', import.meta.url));
export const RECEIPT = fileURLToPath(new URL('./receipt.jpg', import.meta.url));

export async function open({ mobile = true } = {}) {
  // WATCH=1 이면 화면에 브라우저를 띄우고 사람이 쓰는 속도로 진행한다.
  const watch = process.env.WATCH === '1';
  const browser = await chromium.launch({ headless: !watch, slowMo: watch ? 120 : 0 });
  const context = await browser.newContext(
    mobile
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul' }
      : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'ko-KR', timezoneId: 'Asia/Seoul' },
  );
  context.setDefaultTimeout(30000);
  const page = await context.newPage();
  return { browser, context, page };
}
export async function shot(page, name, opts = {}) {
  await page.waitForTimeout(opts.wait ?? 700);
  await page.screenshot({ path: IMG + name + '.png', fullPage: !!opts.full });
  console.log('shot', name);
}
export async function top(page, locator, offset = 84) {
  await locator.first().evaluate((el, off) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - off), offset);
}
export async function login(page, id, pw = 'demo1234', { show } = {}) {
  await page.goto(BASE + '/login');
  await page.getByLabel('아이디', { exact: true }).fill(id);
  await page.getByLabel('비밀번호', { exact: true }).fill(pw);
  if (show) await shot(page, show);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}
