import { expect, test, type Page } from '@playwright/test';

async function login(page: Page) {
  expect(
    (await page.request.post('/api/auth/login', { data: { login_id: 'admin', password: 'admin1234' } })).ok(),
  ).toBe(true);
}
async function fixture(page: Page, suffix: string) {
  const projects = (await (await page.request.get('/api/lookups')).json()).data.projects;
  const invite = await page.request.post('/api/invites', {
    data: { name: `삭제 기사 ${suffix}`, role: 'DRIVER', project_ids: [projects[0].id] },
  });
  expect(invite.ok()).toBe(true);
  const token = (await invite.json()).data.invite_url.split('/').at(-1);
  // A separate request context keeps the administrator's session intact.
  const context = await page.context().browser()!.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const response = await context.request.post(`/api/invites/${token}/accept`, {
      data: {
        client_request_id: crypto.randomUUID(),
        login_id: `delete-${suffix}`,
        password: 'password1234',
        profile: {
          name: `삭제 기사 ${suffix}`,
          phone: `0104321${suffix}`,
          business_name: `삭제 운송 ${suffix}`,
          biz_no: `345670${suffix}`,
          plate_no: `서울90아${suffix}`,
          vehicle_type: '카고',
          tonnage: '1',
        },
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
  } finally {
    await context.close();
  }
  const rows = (await (await page.request.get('/api/admin/users')).json()).data;
  return rows.find((u: { login_id: string }) => u.login_id === `delete-${suffix}`);
}
for (const width of [1440, 390]) {
  for (const path of ['/m/drivers', '/m/users']) {
    test(`${path} ${width}px: 삭제·기록 안내·꺼진 계정 필터와 URL 복원`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 1000 });
      await login(page);
      const suffix = String(7000 + (width === 390 ? 10 : 0) + (path === '/m/users' ? 1 : 0));
      const target = await fixture(page, suffix);
      const disabled = await fixture(page, String(Number(suffix) + 20));
      const recorded = await fixture(page, String(Number(suffix) + 40));
      const masters = (await (await page.request.get('/api/admin/drivers')).json()).data;
      const driver = masters.find((row: { id: string }) => row.id === recorded.driver_id);
      const lookups = (await (await page.request.get('/api/lookups')).json()).data;
      const draft = await page.request.post('/api/uses', {
        data: {
          use_date: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }),
          project_id: lookups.projects[0].id,
          driver_id: driver.id,
          vehicle_id: driver.default_vehicle_id,
          trips: [{ seq: 1, origin: '상차장', destination: '현장' }],
        },
      });
      expect(draft.ok(), await draft.text()).toBe(true);
      expect(
        (
          await page.request.patch(`/api/admin/users/${disabled.id}`, {
            data: { version: 1, status: 'DISABLED' },
          })
        ).ok(),
      ).toBe(true);
      await page.goto(`${path}?keep=retained`);
      const toggle = page.getByRole('checkbox', { name: /꺼진 계정 \d+명 보기/ });
      await expect(toggle).not.toBeChecked();
      const search = page.getByLabel(path === '/m/users' ? '사용자 검색' : '기사 검색', { exact: true });
      await search.fill(disabled.name);
      const row = () =>
        path === '/m/users'
          ? page.locator('article').filter({ hasText: disabled.name })
          : width === 390
            ? page.getByLabel('기사 카드 목록').locator('article').filter({ hasText: disabled.name })
            : page.getByRole('row').filter({ hasText: disabled.name });
      await expect(row()).toHaveCount(0);
      await toggle.check();
      await expect(page).toHaveURL(/keep=retained/);
      await expect(page).toHaveURL(/show_disabled=1/);
      await expect(row()).toBeVisible();
      await page.goBack();
      await expect(toggle).not.toBeChecked();
      await page.goForward();
      await expect(toggle).toBeChecked();
      await page.reload();
      await expect(toggle).toBeChecked();
      await search.fill(disabled.name);
      await expect(row()).toBeVisible();
      await toggle.uncheck();
      await expect(row()).toHaveCount(0);
      await search.fill(target.name);
      const targetRow =
        path === '/m/users'
          ? page.locator('article').filter({ hasText: target.name })
          : width === 390
            ? page.getByLabel('기사 카드 목록').locator('article').filter({ hasText: target.name })
            : page.getByRole('row').filter({ hasText: target.name });
      await targetRow.getByRole('button', { name: '삭제', exact: true }).click();
      await expect(page.getByRole('dialog')).toContainText(target.name);
      await expect(page.getByRole('dialog')).toContainText('되돌릴 수 없어요');
      await page.getByRole('dialog').getByRole('button', { name: '계정 삭제', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(targetRow).toHaveCount(0);
      await search.fill(recorded.name);
      await expect(
        page
          .getByText("운행·정산 기록이 있어 삭제할 수 없어요. '계정 끄기'를 쓰세요.")
          .filter({ visible: true })
          .first(),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: '삭제', exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath('account-management.png'), fullPage: true });
    });
  }
}
