// 설명서 페이지 전체 캡처 + 잘린 글자 자동 검사
import { chromium, BASE, protectContext } from './lib.mjs';
const OUT = process.env.OUT;
const clipScan = () => {
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!el.childNodes.length || el.closest('svg,script,style,[hidden],.sr-only,nextjs-portal')) continue;
    const text = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join('');
    if (!text) continue;
    const cs = getComputedStyle(el);
    const clipped =
      (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible') ||
      (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth);
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const offscreen = r.right > innerWidth + 1 || r.left < -1;
    if (clipped || offscreen)
      out.push(`${clipped ? 'CLIP' : 'OFF'} ${el.tagName} "${text.slice(0, 40)}" ${Math.round(r.width)}px`);
  }
  return out;
};
const b = await chromium.launch();
for (const [w, h, dsf] of [
  [360, 780, 2],
  [390, 844, 2],
  [1440, 900, 1],
]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dsf, isMobile: w < 500 });
  await protectContext(p.context());
  await p.goto(BASE + '/manual', { waitUntil: 'networkidle' });
  await p.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    scrollTo(0, 0);
  });
  await p.waitForTimeout(800);
  const fonts = await p.evaluate(() => ({
    h1: getComputedStyle(document.querySelector('h1')).fontSize,
    h2: getComputedStyle(document.querySelector('h2')).fontSize,
    h3: getComputedStyle(document.querySelector('h3')).fontSize,
    h4: getComputedStyle(document.querySelector('h4')).fontSize,
    body: getComputedStyle(document.querySelector('.manual-step p')).fontSize,
    height: document.body.scrollHeight,
  }));
  console.log(
    w,
    JSON.stringify(fonts),
    'overflowX',
    await p.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  );
  const issues = await p.evaluate(clipScan);
  console.log(issues.length ? issues.join('\n') : '  잘림 없음');
  await p.screenshot({ path: `${OUT}/full-${w}.png`, fullPage: true });
  await p.close();
}
await b.close();
