import { open, shot, top, login, BASE, RECEIPT } from './lib.mjs';
import { IMG } from './lib.mjs';
const { browser, page } = await open();
try {
  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: '로그인', exact: true }).waitFor();
  await shot(page, '01-login');
  await login(page, 'driver1');
  await page.goto(BASE + '/d?from=2026-09-01&to=2026-09-30');
  await page.waitForLoadState('networkidle');
  await page.getByRole('heading', { name: '내 운행' }).waitFor();
  await shot(page, '03-driver-home', { wait: 1500 });
  await page.getByRole('link', { name: '운행 등록' }).first().click();
  await page.waitForURL(/\/d\/new/);
  await page.getByRole('button', { name: '담당자에게 보내기', exact: true }).waitFor();
  await page.waitForLoadState('networkidle');
  await page.getByRole('radio', { name: '서울 현장', exact: true }).check();
  await page.getByLabel('사용일', { exact: true }).fill('2026-09-30');
  await page.getByRole('radio', { name: '박준호 (현장 담당자)', exact: true }).check();
  await page.getByLabel('적재용량 (톤)').fill('1');
  await shot(page, '04-new-top');
  await page.getByLabel('운반 내용', { exact: true }).fill('PVC 배관 자재 20묶음');
  await top(page, page.getByRole('heading', { name: '프로젝트·운행일' }));
  await shot(page, '05-step1-2');
  await top(page, page.getByRole('heading', { name: '담당자·적재용량' }));
  await shot(page, '05b-reviewer-load');
  const recent = page.getByRole('group', { name: '1회차 최근 경로' });
  if (await recent.count()) await recent.getByRole('button').first().click();
  else {
    await page.getByLabel('1회차 출발', { exact: true }).fill('서울 자재창고');
    await page.getByLabel('1회차 도착', { exact: true }).fill('서울 현장 A동');
  }
  await top(page, page.getByRole('heading', { name: '출발 → 도착' }));
  await shot(page, '06-step3-route');
  await top(page, page.getByRole('heading', { name: '요금 확인' }));
  await shot(page, '08-step5-fee');
  // 계약 단가와 다른 금액(예: 조출로 추가된 금액)을 직접 넣는 경우
  await page.getByRole('button', { name: '금액이 다르면 직접 입력' }).click();
  await page.getByLabel('이번 운행 금액(원)', { exact: true }).fill('330000');
  await top(page, page.getByRole('heading', { name: '요금 확인' }));
  await shot(page, '08b-amount-input');
  await page.locator("input[aria-label='사진·파일 선택']").first().setInputFiles(RECEIPT);
  await page.waitForFunction(
    () => [...document.querySelectorAll('img')].some((i) => i.naturalWidth > 0 && i.closest('form, section')),
    undefined,
    { timeout: 30000 },
  );
  await top(page, page.getByRole('heading', { name: '사진·증빙' }));
  await shot(page, '07-step4-photo', { wait: 2500 });
  await page.getByRole('button', { name: '담당자에게 보내기', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: '이대로 보낼까요?' });
  await sheet.waitFor();
  await shot(page, '09-confirm-sheet');
  await sheet.getByRole('button', { name: '보내기', exact: true }).click();
  await page.getByRole('heading', { name: '보냈습니다' }).waitFor({ timeout: 60000 });
  await shot(page, '10-sent', { wait: 1200 });
  await page.getByRole('link', { name: '내 운행으로' }).click();
  await page.getByRole('heading', { name: '내 운행' }).waitFor();
  await page.goto(BASE + '/d?from=2026-09-01&to=2026-09-30');
  await page.waitForLoadState('networkidle');
  await shot(page, '11-home-after-send');
} catch (e) {
  await page.screenshot({ path: IMG + 'error.png' });
  console.error('FAIL', e.message.split('\n').slice(0, 6).join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
