// 화면 높이만큼씩 내려가며 캡처(눈으로 확인용)
import { chromium } from './lib.mjs';
const [w, h] = (process.env.SIZE ?? '360x780').split('x').map(Number);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: w < 500 });
await p.goto((process.env.BASE ?? 'http://localhost:3000') + (process.env.PATH_ ?? '/manual'), { waitUntil: 'networkidle' });
const total = await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 50)); } return document.body.scrollHeight; });
let i = 0;
for (let y = 0; y < total; y += h - 140) {
  await p.evaluate((y) => scrollTo(0, y), y);
  await p.waitForTimeout(250);
  await p.screenshot({ path: `${process.env.OUT}/s-${String(i++).padStart(2, '0')}.png` });
}
console.log('shots', i);
await b.close();
