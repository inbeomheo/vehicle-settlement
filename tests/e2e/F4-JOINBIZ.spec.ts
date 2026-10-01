import { expect, test } from '@playwright/test';

test('새 현장 기본 증빙 선택 → 지정 사업자 링크 → 360px 가입 → 사진 없이 보내기', async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  expect(
    (await page.request.post('/api/auth/login', { data: { login_id: 'admin', password: 'admin1234' } })).ok(),
  ).toBe(true);
  await page.goto('/m/master/projects');
  await page.getByRole('button', { name: '새로 등록', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '증빙 정책', exact: true })).toHaveValue('NONE');
  await page.getByLabel('현장(프로젝트) 이름 (예: 탕정)', { exact: true }).fill('가입 사업자 현장');
  await page.getByLabel('지금 등록된 기사 모두에게 이 현장 배정').uncheck();
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: '가입 사업자 현장' })).toBeVisible();
  await page.goto('/m/drivers');
  await page.getByRole('button', { name: '기사 가입 링크 만들기', exact: true }).click();
  await page.getByRole('checkbox', { name: '가입 사업자 현장', exact: true }).check();
  await page.getByRole('tab', { name: '새 사업자 등록', exact: true }).click();
  await page.getByLabel('소속 사업자 상호').fill('태은화물');
  await page.getByLabel('소속 사업자번호').fill('104-12-34501');
  await page.getByRole('button', { name: '링크 생성', exact: true }).click();
  const link = page.getByLabel('새 기사 가입 링크', { exact: true });
  await expect(link).toBeVisible();
  await expect(page.getByLabel('기사 가입 링크 관리')).toContainText('소속: 태은화물');
  const context = await browser.newContext({ viewport: { width: 360, height: 900 } });
  try {
    const driver = await context.newPage();
    await driver.goto(await link.inputValue());
    await expect(driver.getByText('소속: 태은화물(104-**-***01)', { exact: true })).toBeVisible();
    await expect(driver.getByLabel('사업자번호', { exact: true })).toHaveCount(0);
    await expect(driver.getByLabel('상호명', { exact: true })).toHaveCount(0);
    await driver.getByLabel('이름', { exact: true }).fill('이상규 테스트');
    await driver.getByLabel('전화번호', { exact: true }).fill('01088779991');
    await driver.getByLabel('차량번호', { exact: true }).fill('서울88아9991');
    await driver.getByLabel('차량 최대 적재 (톤)', { exact: true }).fill('8');
    await driver.getByLabel('아이디', { exact: true }).fill('f4-joinbiz-driver');
    await driver.getByLabel('비밀번호', { exact: true }).fill('password1234');
    expect(await driver.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await driver.getByRole('button', { name: '가입하고 시작하기' }).click();
    await expect(driver).toHaveURL(/\/d$/);
    await driver.goto(new URL('/d/new', await link.inputValue()).toString());
    await driver.getByRole('radio', { name: '가입 사업자 현장', exact: true }).check();
    await driver.getByRole('radio', { name: '관리자 (관리자)', exact: true }).check();
    await driver.getByLabel('적재용량 (톤)').fill('8');
    await driver.getByLabel('1회차 출발', { exact: true }).fill('성건 공장');
    await driver.getByLabel('1회차 도착', { exact: true }).fill('탕정 현장');
    await driver.getByLabel('이번 운행 금액(원)', { exact: true }).fill('300000');
    await expect(driver.getByText('사진·증빙 (선택)', { exact: true })).toBeVisible();
    await driver.getByRole('button', { name: '담당자에게 보내기', exact: true }).click();
    await driver.getByRole('dialog').getByRole('button', { name: '보내기', exact: true }).click();
    await expect(driver.getByRole('heading', { name: '보냈습니다', exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

test('기존 운송사 선택과 개별 초대에서도 소속 사업자를 지정한다', async ({ page, browser }) => {
  expect(
    (await page.request.post('/api/auth/login', { data: { login_id: 'admin', password: 'admin1234' } })).ok(),
  ).toBe(true);
  const response = await page.request.post('/api/admin/counterparties', {
    data: { name: '기존 공동운송', biz_no: '104-22-55601', kind: 'CARRIER' },
  });
  expect(response.ok()).toBe(true);
  const party = (await response.json()).data;
  await page.goto('/m/drivers');
  await page.getByRole('button', { name: '기사 가입 링크 만들기', exact: true }).click();
  await page.getByRole('checkbox').first().check();
  await page.getByRole('combobox', { name: '소속 사업자', exact: true }).selectOption(party.id);
  await page.getByRole('button', { name: '링크 생성', exact: true }).click();
  await expect(page.getByLabel('새 기사 가입 링크', { exact: true })).toBeVisible();
  const sharedUrl = await page.getByLabel('새 기사 가입 링크', { exact: true }).inputValue();
  await page.goto('/m/users');
  await page.getByText('사용자 초대 생성', { exact: true }).click();
  await page.getByRole('combobox', { name: '초대 역할', exact: true }).selectOption('DRIVER');
  await page.getByLabel('초대 이름', { exact: true }).fill('개별 기사');
  await page.getByRole('checkbox').first().check();
  await page.getByRole('combobox', { name: '소속 사업자', exact: true }).selectOption(party.id);
  await page.getByRole('button', { name: '초대 링크 생성', exact: true }).click();
  const invite = page.getByLabel('새 초대 링크 (7일·1회 사용)', { exact: true });
  await expect(invite).toBeVisible();
  const context = await browser.newContext({ viewport: { width: 360, height: 900 } });
  try {
    const driver = await context.newPage();
    for (const url of [sharedUrl, await invite.inputValue()]) {
      await driver.goto(url);
      await expect(driver.getByText('소속: 기존 공동운송(104-**-***01)', { exact: true })).toBeVisible();
      await expect(driver.getByLabel('사업자번호', { exact: true })).toHaveCount(0);
      expect(await driver.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  } finally {
    await context.close();
  }
});

test('설명서는 사진 선택과 같은 운송사 지정 가입을 웹·PDF에 안내한다', async ({ page }) => {
  await page.goto('/manual');
  await expect(page.locator('main')).toContainText('사진·증빙은 선택');
  await expect(page.locator('main')).toContainText('같은 운송사 기사 여러 명');
  await expect(page.locator('main')).toContainText('소속 사업자를 지정');
  const response = await page.request.get('/manual/vehicle-manual.pdf');
  const { extractPdfText } = await import('../helpers/pdf');
  const text = extractPdfText(await response.body()).replace(/\s+/g, ' ');
  expect(text).toContain('사진·증빙은 선택');
  expect(text).toContain('같은 운송사 기사 여러 명');
});
