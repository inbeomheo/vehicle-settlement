import { open, shot, login, BASE, IMG } from './lib.mjs';
const { browser, page } = await open({ mobile: false });
try {
  await login(page, 'admin', 'admin1234');
  for (const [path, file] of [['/m/master/form-fields', '40-form-fields'], ['/m/users', '41-users'], ['/m/master', '42-master'], ['/m/account', '44-password-change-m']]) {
    await page.goto(BASE + path);
    await page.waitForLoadState('networkidle');
    await shot(page, file, { wait: 2000 });
  }
} catch (e) {
  await page.screenshot({ path: IMG + 'error.png' });
  console.error('FAIL', e.message.split('\n').slice(0, 8).join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
