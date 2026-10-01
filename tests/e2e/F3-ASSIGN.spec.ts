import { expect, test, type Page } from '@playwright/test';
const message = "아직 배정된 현장이 없어요. 관리자에게 '기사관리'에서 현장을 배정해 달라고 하세요.";
async function login(page: Page, login_id = 'admin') {
  expect(
    (
      await page.request.post('/api/auth/login', {
        data: { login_id, password: login_id === 'admin' ? 'admin1234' : 'demo1234' },
      })
    ).ok(),
  ).toBe(true);
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
test('360px·20px 배정 0개 안내 → 기사관리 배정·회수 → 기사 현장 선택', async ({ page, browser }) => {
  test.setTimeout(90_000);
  await login(page);
  const users = (await (await page.request.get('/api/admin/users')).json()).data;
  const user = users.find((u: { login_id: string }) => u.login_id === 'driver2');
  const assigned = user.assignments.filter((a: { revoked_at: string | null }) => !a.revoked_at);
  for (const a of assigned)
    expect((await page.request.delete(`/api/admin/assignments/${a.id}`)).ok()).toBe(true);
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: { width: 360, height: 900 },
  });
  try {
    const driver = await context.newPage();
    await driver.addInitScript(() => localStorage.setItem('vehicle-text-size', 'xlarge'));
    await login(driver, 'driver2');
    await driver.goto('/d');
    await expect(driver.getByText(message, { exact: true })).toHaveCount(1);
    expect(await driver.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('20px');
    await fits(driver);
    await driver.goto('/d/new');
    await expect(driver.getByText(message, { exact: true })).toBeVisible();
    await expect(driver.getByRole('button', { name: '담당자에게 보내기', exact: true })).toBeDisabled();
    await expect(driver.getByLabel('현장', { exact: true })).toHaveCount(0);
    await driver.screenshot({ path: test.info().outputPath('no-project-360.png'), fullPage: true });
    await fits(driver);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/m');
    await expect(page.getByRole('link', { name: /현장 배정이 없는 기사.*기사관리에서 배정/ })).toBeVisible();
    await page.goto('/m/drivers');
    await page.getByLabel('기사 검색').fill(user.login_id);
    await expect(page.getByRole('row').filter({ hasText: user.name })).toContainText('현장 배정 필요');
    await page.getByRole('button', { name: '현장 배정', exact: true }).filter({ visible: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('checkbox').first()).toBeVisible();
    const projectName = await dialog.getByRole('checkbox').first().getAttribute('aria-label');
    await dialog.getByRole('checkbox').first().check();
    await expect(dialog.getByRole('status')).toContainText('배정했어요');
    await driver.reload();
    await expect(driver.getByText(message, { exact: true })).toHaveCount(0);
    await expect(driver.getByRole('radio', { name: projectName!, exact: true })).toBeVisible();
    await dialog.getByRole('checkbox').first().uncheck();
    await expect(dialog.getByRole('status')).toContainText('해제했어요');
    await driver.reload();
    await expect(driver.getByText(message, { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 900 });
    await dialog.getByRole('button', { name: '모든 현장 선택' }).click();
    await expect(dialog.getByRole('checkbox').first()).toBeChecked();
    await expect(dialog.getByRole('button', { name: '모든 현장 선택' })).toBeEnabled();
    for (const checkbox of await dialog.getByRole('checkbox').all()) await expect(checkbox).toBeChecked();
    await fits(page);
    await page.screenshot({ path: test.info().outputPath('assign-390.png'), fullPage: true });
  } finally {
    const now = (await (await page.request.get('/api/admin/assignments')).json()).data;
    for (const a of now.filter(
      (a: { user_id: string; revoked_at: string | null }) => a.user_id === user.id && !a.revoked_at,
    ))
      await page.request.delete(`/api/admin/assignments/${a.id}`);
    for (const a of assigned)
      await page.request.post('/api/admin/assignments', {
        data: { user_id: user.id, project_id: a.project_id, valid_from: a.valid_from, valid_to: a.valid_to },
      });
    await context.close();
  }
});
test('새 현장의 기본 자동 배정과 배정 인원 안내', async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 390, height: 900 });
  const name = `F3 자동 현장 ${Date.now()}`;
  const users = (await (await page.request.get('/api/admin/users')).json()).data;
  const count = users.filter(
    (u: { role: string; status: string }) => u.role === 'DRIVER' && u.status === 'ACTIVE',
  ).length;
  await page.goto('/m/master/projects');
  await page.getByRole('button', { name: '새로 등록', exact: true }).click();
  await expect(page.getByLabel('지금 등록된 기사 모두에게 이 현장 배정')).toBeChecked();
  await page.getByLabel('현장(프로젝트) 이름 (예: 탕정)', { exact: true }).fill(name);
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: `기사 ${count}명에게 배정했어요` })).toBeVisible();
  await fits(page);
  await login(page, 'driver1');
  const projects = (await (await page.request.get('/api/lookups')).json()).data.projects;
  expect(projects.some((p: { name: string }) => p.name === name)).toBe(true);
});
test('개별 기사 초대·공용 가입 링크 현장 필수와 모든 현장 선택', async ({ page }) => {
  await login(page);
  await page.goto('/m/users');
  await page.getByText('사용자 초대 생성', { exact: true }).click();
  await page.getByLabel('초대 역할').selectOption('DRIVER');
  await expect(page.getByRole('button', { name: '초대 링크 생성', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '모든 현장 선택', exact: true }).click();
  await expect(page.getByRole('button', { name: '초대 링크 생성', exact: true })).toBeEnabled();
  await page.goto('/m/drivers');
  await page.getByRole('button', { name: '기사 가입 링크 만들기', exact: true }).click();
  await expect(page.getByRole('button', { name: '링크 생성', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '모든 현장 선택', exact: true }).click();
  await expect(page.getByRole('button', { name: '링크 생성', exact: true })).toBeEnabled();
});
