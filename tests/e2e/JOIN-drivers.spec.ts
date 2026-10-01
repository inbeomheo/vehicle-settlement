import { expect, test, type Page } from '@playwright/test';
async function login(page: Page) {
  expect(
    (await page.request.post('/api/auth/login', { data: { login_id: 'admin', password: 'admin1234' } })).ok(),
  ).toBe(true);
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function fillProfile(page: Page, suffix: string) {
  await page.getByLabel('이름', { exact: true }).fill(`가입 기사 ${suffix}`);
  await page.getByLabel('전화번호', { exact: true }).fill(`0103456${suffix}`);
  await page.getByLabel('상호명', { exact: true }).fill(`기사 운송 ${suffix}`);
  await page.getByLabel('사업자번호', { exact: true }).fill(`120340${suffix}`);
  await expect(page.getByLabel('사업자번호', { exact: true })).toHaveValue(`120-34-0${suffix}`);
  await page.getByLabel('차량번호', { exact: true }).fill(`서울80아${suffix}`);
  await page.getByLabel('차량 최대 적재 (톤)', { exact: true }).fill('8');
}
for (const font of ['보통', '아주 크게']) {
  test(`공용 링크 → 360px 가입 → 기사관리 표 → 내 정보 수정 (${font})`, async ({ page, browser }) => {
    test.setTimeout(90_000);
    const suffix = font === '보통' ? '6101' : '6102';
    await page.setViewportSize({ width: 360, height: 900 });
    await page.addInitScript(
      (size) => localStorage.setItem('vehicle-text-size', size),
      font === '아주 크게' ? 'xlarge' : 'normal',
    );
    await login(page);
    await page.goto('/m/drivers');
    await page.getByRole('button', { name: '기사 가입 링크 만들기', exact: true }).click();
    await page.getByRole('checkbox').first().check();
    await expect(page.getByLabel('유효기간 (일)')).toHaveValue('14');
    await page.getByRole('button', { name: '링크 생성', exact: true }).click();
    const linkField = page.getByLabel('새 기사 가입 링크', { exact: true });
    await expect(linkField).toBeVisible();
    const link = await linkField.inputValue();
    await fits(page);
    const context = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      viewport: { width: 360, height: 900 },
    });
    try {
      const driver = await context.newPage();
      await driver.goto(link);
      await expect(driver.getByRole('button', { name: '가입하고 시작하기' })).toBeEnabled();
      await driver.getByRole('radio', { name: `글자 ${font}`, exact: true }).click();
      await fillProfile(driver, suffix);
      await driver.getByLabel('아이디', { exact: true }).fill(`join-e2e-${suffix}`);
      await driver.getByLabel('비밀번호', { exact: true }).fill('password1234');
      await fits(driver);
      await driver.screenshot({ path: test.info().outputPath('join-360.png'), fullPage: true });
      await driver.getByRole('button', { name: '가입하고 시작하기' }).click();
      await expect(driver).toHaveURL(/\/d$/);
      await driver.getByRole('link', { name: '내 정보', exact: true }).click();
      await expect(driver.getByLabel('전화번호', { exact: true })).toHaveValue(`0103456${suffix}`);
      await driver.getByLabel('상호명', { exact: true }).fill(`변경 운송 ${suffix}`);
      await driver.getByLabel('차량번호', { exact: true }).fill(`경기80아${suffix}`);
      await driver.getByLabel('차량 최대 적재 (톤)', { exact: true }).fill('10.5');
      await driver.getByRole('button', { name: '정보 저장' }).click();
      await expect(driver.getByRole('status').filter({ hasText: '내 정보를 저장했습니다.' })).toBeVisible();
      await expect(driver.getByLabel('차량 최대 적재 (톤)', { exact: true })).toHaveValue('10.500');
      await expect(driver.getByRole('link', { name: '비밀번호 변경', exact: true })).toBeVisible();
      await fits(driver);
      await driver.screenshot({ path: test.info().outputPath('profile-360.png'), fullPage: true });
      await page.reload();
      await page.getByLabel('기사 검색', { exact: true }).fill(`가입 기사 ${suffix}`);
      const card = page.getByLabel('기사 카드 목록').locator('article');
      await expect(card).toHaveCount(1);
      await expect(card).toContainText(`변경 운송 ${suffix}`);
      await expect(card).toContainText(`경기80아${suffix}`);
      await fits(page);
      await page.screenshot({ path: test.info().outputPath('directory-360.png'), fullPage: true });
      await card.getByRole('button', { name: '정보 수정', exact: true }).click();
      await page.getByRole('dialog').getByLabel('이름', { exact: true }).fill(`수정 기사 ${suffix}`);
      await page.getByRole('dialog').getByRole('button', { name: '정보 저장' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.getByLabel('기사 검색', { exact: true }).fill(`수정 기사 ${suffix}`);
      await page.setViewportSize({ width: 1440, height: 1000 });
      const row = page.getByRole('row').filter({ hasText: `수정 기사 ${suffix}` });
      await expect(row).toBeVisible();
      await expect(row).toContainText('10.5톤');
      await row.getByRole('button', { name: '비밀번호 재설정 링크', exact: true }).click();
      await expect(page.getByRole('dialog').getByLabel('비밀번호 재설정 링크')).toHaveValue(/\/reset\//);
      await page.keyboard.press('Escape');
      await row.getByRole('button', { name: '계정 끄기' }).click();
      await page.getByRole('dialog').getByRole('button', { name: '계정 상태 변경' }).click();
      await expect(row).toContainText('비활성');
      expect((await driver.request.get('/api/driver-profile')).status()).toBe(401);
      await row.getByRole('button', { name: '계정 켜기' }).click();
      await page.getByRole('dialog').getByRole('button', { name: '계정 상태 변경' }).click();
      await expect(row).toContainText('활성');
      await page.screenshot({ path: test.info().outputPath('directory-desktop.png'), fullPage: true });
    } finally {
      await context.close();
    }
  });
}
test('현장 이름만 등록·수정·삭제하고 연결 현장은 사용 중지 안내', async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto('/m/master/projects');
  await page.getByRole('button', { name: '새로 등록', exact: true }).click();
  await page.getByLabel('현장(프로젝트) 이름 (예: 탕정)', { exact: true }).fill('JOIN 새 현장');
  await page.getByLabel('지금 등록된 기사 모두에게 이 현장 배정').uncheck();
  await expect(page.getByLabel('현장 코드 (선택, 비우면 자동)', { exact: true })).toBeEmpty();
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByLabel('목록 검색').fill('JOIN 새 현장');
  const row = page.getByRole('row').filter({ hasText: 'JOIN 새 현장' });
  await expect(row).toContainText('P-');
  await row.getByRole('button', { name: '수정', exact: true }).click();
  await page.getByLabel('현장(프로젝트) 이름 (예: 탕정)', { exact: true }).fill('JOIN 수정 현장');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByLabel('목록 검색').fill('JOIN 수정 현장');
  await page
    .getByRole('row')
    .filter({ hasText: 'JOIN 수정 현장' })
    .getByRole('button', { name: '삭제', exact: true })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: '현장 삭제', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'JOIN 수정 현장' })).toHaveCount(0);
  await page.getByLabel('목록 검색').fill('서울');
  await page
    .getByRole('row')
    .filter({ hasText: '서울' })
    .getByRole('button', { name: '삭제', exact: true })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: '현장 삭제', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('사용 중지');
  await fits(page);
});
test('기사 연결 없는 개별 초대는 정보 입력 화면, 꺼진 공용 링크는 가입 불가', async ({ page, browser }) => {
  await login(page);
  const project = (await (await page.request.get('/api/lookups')).json()).data.projects[0];
  const invite = await page.request.post('/api/invites', {
    data: { name: '개별 가입', role: 'DRIVER', project_ids: [project.id] },
  });
  expect(invite.ok()).toBe(true);
  const context = await browser.newContext({ viewport: { width: 360, height: 900 } });
  try {
    const driver = await context.newPage();
    await driver.goto((await invite.json()).data.invite_url);
    await expect(driver.getByLabel('이름', { exact: true })).toHaveValue('개별 가입');
    await expect(driver.getByLabel('사업자번호', { exact: true })).toBeVisible();
    await fits(driver);
    await page.goto('/m/drivers');
    await page.getByRole('button', { name: '기사 가입 링크 만들기' }).click();
    await page.getByRole('checkbox').first().check();
    await page.getByRole('button', { name: '링크 생성', exact: true }).click();
    const url = await page.getByLabel('새 기사 가입 링크', { exact: true }).inputValue();
    await page.getByRole('button', { name: '링크 끄기', exact: true }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: '링크 끄기 확인' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await driver.goto(url);
    await expect(driver.locator('main').getByRole('alert')).toContainText('만료되었거나 꺼진');
    await expect(driver.getByRole('button', { name: '가입하고 시작하기' })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('현장·정산 담당자는 일반 기사 정보 읽기 전용, 정산은 소속 시작일만 수정 가능', async ({ page }) => {
  for (const login_id of ['site', 'settlement']) {
    expect(
      (await page.request.post('/api/auth/login', { data: { login_id, password: 'demo1234' } })).ok(),
    ).toBe(true);
    await page.goto('/m/drivers');
    await expect(page.getByRole('heading', { name: '기사관리', exact: true })).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('button', { name: '정보 수정' })).toHaveCount(0);
    if (login_id === 'site')
      await expect(page.getByRole('button', { name: '소속 시작일 수정' })).toHaveCount(0);
    else await expect(page.getByRole('button', { name: '소속 시작일 수정' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: '기사 가입 링크 만들기' })).toHaveCount(0);
    expect((await page.request.post('/api/driver-join-links', { data: { project_ids: [] } })).status()).toBe(
      403,
    );
  }
});
