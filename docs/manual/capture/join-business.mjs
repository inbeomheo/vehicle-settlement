import { BASE, open, login, shot, top } from './lib.mjs';

// F4-JOINBIZ: capture only the administrator's business-designated link form.
const { browser, page } = await open({ mobile: false });
try {
  await login(page, 'admin', 'admin1234');
  await page.goto(BASE + '/m/drivers');
  await page.getByRole('button', { name: '기사 가입 링크 만들기', exact: true }).click();
  const section = page.getByRole('region', { name: '기사 가입 링크 관리' });
  await section.getByRole('checkbox').first().check();
  await section.getByRole('tab', { name: '새 사업자 등록', exact: true }).click();
  await section.getByLabel('소속 사업자 상호').fill('성호 운수 (시연)');
  await section.getByLabel('소속 사업자번호').fill('000-00-00000');
  await top(page, section, 24);
  await shot(page, '46-join-link');
} finally {
  await browser.close();
}
