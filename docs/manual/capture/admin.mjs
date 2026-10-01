import { open, shot, top, login, BASE, IMG } from './lib.mjs';
const { browser, page } = await open({ mobile: false });
try {
  await login(page, 'admin', 'admin1234');
  for (const [path, file] of [
    ['/m/master/form-fields', '40-form-fields'],
    ['/m/users', '41-users'],
    ['/m/master', '42-master'],
    ['/m/account', '44-password-change-m'],
    ['/m/drivers', '45-drivers'],
  ]) {
    await page.goto(BASE + path);
    await page.waitForLoadState('networkidle');
    await shot(page, file, {
      mask: path === '/m/users' ? [page.getByText(/^(admin|driver[12]|site|settlement) ·/)] : [],
    });
  }
  await page.getByRole('button', { name: '기사 가입 링크 만들기', exact: true }).click();
  await page.getByRole('checkbox').first().check();
  await shot(page, '46-join-link');
  await page.getByRole('button', { name: '링크 생성', exact: true }).click();
  const link = page.getByLabel('새 기사 가입 링크', { exact: true });
  await link.waitFor();
  const joinUrl = await link.inputValue();
  if (new URL(joinUrl).origin !== BASE) throw new Error('로컬 가입 링크가 아닙니다.');
  const mobile = await open();
  try {
    await mobile.page.goto(joinUrl);
    await mobile.page.getByLabel('이름', { exact: true }).waitFor();
    await shot(mobile.page, '47-join');
    await top(mobile.page, mobile.page.getByLabel('상호명', { exact: true }), 100);
    await shot(mobile.page, '47b-join-vehicle');
  } finally {
    await mobile.browser.close();
  }
  await page.goto(BASE + '/m/master/projects');
  await page.getByRole('button', { name: '새로 등록', exact: true }).click();
  await page.getByLabel('현장(프로젝트) 이름 (예: 탕정)', { exact: true }).fill('수원 자재 현장');
  await shot(page, '48-project-create');
} catch (e) {
  await page.screenshot({ path: IMG + 'error.png' });
  console.error('FAIL', e.message.split('\n').slice(0, 8).join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
