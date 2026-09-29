// 앱 주요 화면에서 글자 잘림·화면 밖 넘침 자동 검사 (글자 크기 3단계)
import { chromium, BASE } from './lib.mjs';
const scan = () => {
  const out = [];
  const scrollable = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if ((o === 'auto' || o === 'scroll') && p.scrollWidth > p.clientWidth) return true; } return false; };
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('svg,script,style,[hidden],nextjs-portal')) continue;
    const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
    if (!text) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el);
    const over = el.scrollWidth > el.clientWidth + 1;
    if (over && cs.textOverflow === 'ellipsis') out.push(`… ${text.slice(0, 30)}`);
    else if (over && cs.overflowX !== 'visible') out.push(`CLIP ${el.tagName} "${text.slice(0, 30)}"`);
    else if ((r.right > innerWidth + 1 || r.left < -1) && !scrollable(el)) out.push(`OFF ${el.tagName} "${text.slice(0, 30)}"`);
  }
  return [...new Set(out)];
};
const b = await chromium.launch();
async function check(login, pw, paths, width, size) {
  const ctx = await b.newContext({ viewport: { width, height: 800 }, isMobile: width < 500 });
  await ctx.addInitScript((s) => localStorage.setItem('vehicle-text-size', s), size);
  const page = await ctx.newPage();
  await page.request.post(BASE + '/api/auth/login', { data: { login_id: login, password: pw } });
  for (const path of paths) {
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const issues = await page.evaluate(scan);
    const ox = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    const real = issues.filter((i) => !i.startsWith('…'));
    console.log(`${width}px ${size} ${path}: 가로넘침 ${ox}${real.length ? '\n   ' + real.join('\n   ') : ''}${issues.length - real.length ? `  (말줄임 ${issues.length - real.length}곳)` : ''}`);
  }
  await ctx.close();
}
const driverPaths = ['/d', '/d/new', '/d/settlements?month=2026-09'];
for (const size of ['normal', 'large', 'xlarge']) await check('driver1', 'demo1234', driverPaths, 360, size);
const managerPaths = ['/m', '/m/review', '/m/ledger', '/m/statements', '/m/payments', '/m/users', '/m/master/form-fields'];
for (const [w, size] of [[390, 'normal'], [390, 'xlarge'], [1440, 'normal'], [1440, 'xlarge']]) await check('admin', 'admin1234', managerPaths, w, size);
await b.close();
