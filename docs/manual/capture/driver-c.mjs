import { open, shot, login, BASE } from './lib.mjs';
const { browser, page } = await open();
await login(page, 'driver1');
await page.goto(BASE + '/d/settlements?month=2026-09');
await page.getByRole('heading', { name: '9월 운행' }).waitFor();
await shot(page, '15-my-settlement', { wait: 1500 });
await browser.close();
