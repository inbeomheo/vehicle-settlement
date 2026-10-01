import { mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../../package.json', import.meta.url));
export const { chromium } = require('@playwright/test');
const localBase = 'http://localhost:3183';
const requestedBase = process.env.BASE ?? localBase;
if (
  ![
    localBase,
    localBase + '/',
    'http://localhost:3191',
    'http://localhost:3191/',
    'http://localhost:3197',
    'http://localhost:3197/',
  ].includes(requestedBase)
) {
  throw new Error(
    '설명서 도구는 http://localhost:3183, http://localhost:3191 또는 http://localhost:3197 로컬 서버만 사용할 수 있습니다. 운영 접속은 금지합니다.',
  );
}
export const BASE = requestedBase.replace(/\/$/, '');
export async function protectContext(context) {
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.origin === BASE ? route.continue() : route.abort('blockedbyclient');
  });
}
export const IMG = process.env.IMG ?? fileURLToPath(new URL('../img/', import.meta.url));
export const RECEIPT = fileURLToPath(new URL('./receipt.jpg', import.meta.url));

export async function open({ mobile = true } = {}) {
  // WATCH=1 이면 화면에 브라우저를 띄우고 사람이 쓰는 속도로 진행한다.
  const watch = process.env.WATCH === '1';
  const browser = await chromium.launch({ headless: !watch, slowMo: watch ? 120 : 0 });
  const context = await browser.newContext(
    mobile
      ? {
          viewport: { width: 390, height: 844 },
          deviceScaleFactor: 2,
          isMobile: true,
          hasTouch: true,
          locale: 'ko-KR',
          timezoneId: 'Asia/Seoul',
        }
      : {
          viewport: { width: 1440, height: 900 },
          deviceScaleFactor: 1,
          locale: 'ko-KR',
          timezoneId: 'Asia/Seoul',
        },
  );
  await protectContext(context);
  await context.grantPermissions(['notifications'], { origin: BASE });
  await context.addInitScript(() => localStorage.setItem('vehicle-text-size', 'normal'));
  context.setDefaultTimeout(30000);
  const page = await context.newPage();
  return { browser, context, page };
}
export async function shot(page, name, opts = {}) {
  await page.waitForTimeout(opts.wait ?? 700);
  await page.evaluate(() => document.fonts.ready);
  await mkdir(IMG, { recursive: true });
  await page.screenshot({
    path: join(IMG, name + '.png'),
    fullPage: !!opts.full,
    style: 'nextjs-portal { display: none !important; }',
    mask: opts.mask ?? [],
    maskColor: '#cbd5e1',
  });
  await copyFile(
    join(IMG, name + '.png'),
    fileURLToPath(new URL('../../../public/manual/' + name + '.png', import.meta.url)),
  );
  console.log('shot', name);
}
export async function top(page, locator, offset = 84) {
  await locator
    .first()
    .evaluate((el, off) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - off), offset);
}
export async function login(page, id, pw = 'demo1234') {
  await page.goto(BASE + '/login');
  await page.getByLabel('아이디', { exact: true }).fill(id);
  await page.getByLabel('비밀번호', { exact: true }).fill(pw);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}
