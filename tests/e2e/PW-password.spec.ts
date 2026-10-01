import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, login_id: string, password: string) {
  expect((await page.request.post('/api/auth/login', { data: { login_id, password } })).ok()).toBe(true);
}
async function createAccount(page: Page, role: 'DRIVER' | 'SITE_MANAGER') {
  const name = `비밀번호 시험 ${role} ${Date.now()}`;
  let driver_id: string | undefined;
  if (role === 'DRIVER') {
    const driver = await page.request.post('/api/admin/drivers', { data: { name } });
    expect(driver.ok()).toBe(true);
    driver_id = (await driver.json()).data.id;
  }
  const projects = await page.request.get('/api/lookups');
  const project_ids = role === 'DRIVER' ? [(await projects.json()).data.projects[0].id] : [];
  const response = await page.request.post('/api/invites', {
    data: { name, role, driver_id, project_ids },
  });
  expect(response.ok()).toBe(true);
  const link = (await response.json()).data.invite_url as string;
  return { name, token: new URL(link).pathname.split('/').at(-1)!, login_id: `pw-${role}-${Date.now()}` };
}

test('관리자가 재설정 링크 생성 → 새 브라우저에서 변경 → 새 비밀번호 로그인', async ({ page, browser }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 360, height: 900 });
  await signIn(page, 'admin', 'admin1234');
  const account = await createAccount(page, 'SITE_MANAGER');
  const recipient = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: { width: 360, height: 900 },
  });
  try {
    const accepted = await recipient.request.post(`/api/invites/${account.token}/accept`, {
      data: { login_id: account.login_id, password: 'initial1234' },
    });
    expect(accepted.ok()).toBe(true);
    await recipient.clearCookies();
    await page.goto('/m/users');
    await page.getByLabel('사용자 검색').fill(account.login_id);
    const user = page.locator('article').filter({ hasText: account.login_id });
    await user.getByRole('button', { name: '비밀번호 재설정 링크 만들기', exact: true }).click();
    const link = user.getByLabel('비밀번호 재설정 링크', { exact: true });
    await expect(link).toBeVisible();
    await expect(user.getByRole('button', { name: '복사', exact: true })).toBeVisible();
    await expect(user).toContainText(
      '이 링크를 본인에게 문자로 보내세요. 24시간 동안 한 번만 쓸 수 있습니다.',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const resetPage = await recipient.newPage();
    const resetURL = await link.inputValue();
    await resetPage.goto(resetURL);
    await expect(resetPage.locator('dl')).toContainText(account.name);
    await expect(resetPage.locator('dl')).toContainText(account.login_id);
    await resetPage.getByLabel('새 비밀번호', { exact: true }).fill('changed1234');
    await resetPage.getByLabel('새 비밀번호 확인', { exact: true }).fill('different1234');
    await resetPage.getByRole('button', { name: '비밀번호 바꾸기' }).click();
    await expect(resetPage.locator('main').getByRole('alert')).toHaveText('새 비밀번호가 서로 다릅니다.');
    await resetPage.getByLabel('새 비밀번호 확인', { exact: true }).fill('changed1234');
    expect(await resetPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await resetPage.screenshot({ path: test.info().outputPath('reset-360.png'), fullPage: true });
    await resetPage.getByRole('button', { name: '비밀번호 바꾸기' }).click();
    await expect(resetPage.getByRole('status')).toHaveText(
      '비밀번호를 바꿨습니다. 새 비밀번호로 로그인하세요.',
    );
    await resetPage.getByRole('link', { name: '로그인', exact: true }).click();
    await resetPage.getByLabel('아이디', { exact: true }).fill(account.login_id);
    await resetPage.getByLabel('비밀번호', { exact: true }).fill('changed1234');
    await resetPage.getByRole('button', { name: '로그인', exact: true }).click();
    await expect(resetPage).toHaveURL(/\/m$/);
    const menu = resetPage.getByRole('button', { name: '메뉴', exact: true });
    // The server-rendered menu can appear before its click handler is hydrated.
    await expect(async () => {
      if ((await menu.getAttribute('aria-expanded')) === 'false') await menu.click();
      await expect(menu).toHaveAttribute('aria-expanded', 'true', { timeout: 1000 });
    }).toPass({ timeout: 5000 });
    await resetPage.getByRole('link', { name: '비밀번호 변경', exact: true }).click();
    await expect(resetPage.getByRole('heading', { name: '비밀번호 변경' })).toBeVisible();
    expect(await resetPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await resetPage.goto(resetURL);
    await expect(resetPage.locator('main').getByRole('alert')).toHaveText(
      '링크가 만료되었거나 이미 사용되었습니다. 관리자에게 새 링크를 요청하세요.',
    );
    await expect(resetPage.locator('form')).toHaveCount(0);
  } finally {
    await recipient.close();
  }
});

test('기사 본인 비밀번호 변경 360px: 현재 암호 검증·다른 세션 폐기·글자 확대', async ({ page, browser }) => {
  test.setTimeout(90_000);
  await signIn(page, 'admin', 'admin1234');
  const account = await createAccount(page, 'DRIVER');
  const driver = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: { width: 360, height: 900 },
  });
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    expect(
      (
        await driver.request.post(`/api/invites/${account.token}/accept`, {
          data: { login_id: account.login_id, password: 'initial1234' },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await other.request.post('/api/auth/login', {
          data: { login_id: account.login_id, password: 'initial1234' },
        })
      ).ok(),
    ).toBe(true);
    const driverPage = await driver.newPage();
    await driverPage.goto('/d');
    await driverPage.getByRole('link', { name: '비밀번호 변경', exact: true }).click();
    await expect(driverPage).toHaveURL(/\/d\/account$/);
    await driverPage.getByLabel('현재 비밀번호', { exact: true }).fill('wrong1234');
    await driverPage.getByLabel('새 비밀번호', { exact: true }).fill('drivernew1234');
    await driverPage.getByLabel('새 비밀번호 확인', { exact: true }).fill('drivernew1234');
    await driverPage.getByRole('button', { name: '비밀번호 바꾸기' }).click();
    await expect(driverPage.locator('main').getByRole('alert')).toHaveText('현재 비밀번호를 확인하세요.');
    await driverPage.getByLabel('현재 비밀번호', { exact: true }).fill('initial1234');
    await driverPage.evaluate(() => {
      document.documentElement.style.fontSize = '20px';
    });
    expect(await driverPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const field of await driverPage.locator('input, form button').all())
      expect((await field.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await driverPage.screenshot({ path: test.info().outputPath('account-driver-360.png'), fullPage: true });
    await driverPage.getByRole('button', { name: '비밀번호 바꾸기' }).click();
    await expect(driverPage.getByRole('status').filter({ hasText: '비밀번호를 바꿨습니다' })).toBeVisible();
    expect((await driver.request.get('/api/me')).ok()).toBe(true);
    expect((await other.request.get('/api/me')).status()).toBe(401);
    expect(
      (
        await other.request.post('/api/auth/login', {
          data: { login_id: account.login_id, password: 'drivernew1234' },
        })
      ).ok(),
    ).toBe(true);
  } finally {
    await driver.close();
    await other.close();
  }
});
