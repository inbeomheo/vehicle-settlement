// F3-ASSIGN: 로컬 시연 계정으로 변경된 두 장면만 촬영한다.
import { open, shot, login, BASE } from './lib.mjs';
if (BASE !== 'http://localhost:3191') throw new Error('현장 배정 캡처는 로컬 3191에서만 실행하세요.');
const { browser, page } = await open({ mobile: false });
try {
  await login(page, 'admin', 'admin1234');
  await page.goto(BASE + '/m/drivers');
  await page.getByLabel('기사 검색').fill('김성호');
  await page.getByRole('button', { name: '현장 배정', exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('dialog').getByRole('checkbox').first().waitFor();
  await shot(page, '45-drivers');
  await page.goto(BASE + '/m/master/projects');
  await page.getByRole('button', { name: '새로 등록', exact: true }).click();
  await page.getByLabel('현장(프로젝트) 이름 (예: 탕정)', { exact: true }).fill('수원 자재 현장');
  await page.getByLabel('지금 등록된 기사 모두에게 이 현장 배정').waitFor();
  await shot(page, '48-project-create');
} finally {
  await browser.close();
}
