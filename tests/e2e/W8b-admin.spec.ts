import { expect, test } from '@playwright/test';

for (const width of [360, 390, 1440]) {
  test(`3·6·9·10·11. 관리자 초대·변경 이력·단가 ${width}px`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 900 });
    expect(
      (
        await page.request.post('/api/auth/login', { data: { login_id: 'admin', password: 'admin1234' } })
      ).ok(),
    ).toBe(true);
    const name = `W8b 새 기사 ${width} ${Date.now()}`;
    const driverResponse = await page.request.post('/api/admin/drivers', {
      data: { name, phone: '010-1234-5678' },
    });
    expect(driverResponse.ok()).toBe(true);
    const driver = (await driverResponse.json()).data;
    const userResponse = await page.request.get('/api/admin/users');
    const accounts = (await userResponse.json()).data as { driver_id: string | null }[];
    const linked = accounts.find((user) => user.driver_id)!;

    await page.goto('/m/users');
    await page.getByText('사용자 초대 생성', { exact: true }).click();
    await page.getByLabel('초대 역할').selectOption('DRIVER');
    const select = page.getByRole('combobox', { name: /^기사 연결/ });
    await expect(select.locator(`option[value="${driver.id}"]`)).toHaveCount(1);
    await expect(select.locator(`option[value="${linked.driver_id}"]`)).toHaveCount(0);
    await expect(page.getByRole('link', { name: '새 기사 먼저 등록' })).toHaveAttribute(
      'href',
      '/m/master/drivers',
    );
    await select.selectOption(driver.id);
    await page.getByLabel('초대 이름').fill(name);
    const invitation = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/invites' && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '초대 링크 생성', exact: true }).click();
    const invite = (await (await invitation).json()).data;
    await expect(page.getByLabel('새 초대 링크 (7일·1회 사용)')).toHaveValue(invite.invite_url);
    const invitePath = new URL(invite.invite_url).pathname;
    await page.goto(invitePath);
    await expect(page.getByRole('heading', { name: '초대 수락' })).toBeVisible();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await expect(page.locator('dl')).toContainText('기사');
    await expect(page.locator('dl')).toContainText('한결 건설');
    await expect(page.getByRole('button', { name: '가입하고 시작하기' })).toBeVisible();
    expect(
      await page
        .getByLabel('아이디', { exact: true })
        .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
    ).toBeGreaterThanOrEqual(16);
    expect((await page.request.delete(`/api/invites/${invite.id}`)).ok()).toBe(true);
    await page.reload();
    await expect(page.locator('main').getByRole('alert')).toHaveText('이미 사용되었거나 만료된 초대입니다');
    await expect(page.locator('form')).toHaveCount(0);

    await page.goto('/m/audit');
    await page.getByLabel('대상 유형').selectOption('drivers');
    await expect(page.getByRole('combobox', { name: /^사용자/ })).toHaveJSProperty('tagName', 'SELECT');
    await expect(page.getByLabel('사용번호·명세번호 검색')).toBeVisible();
    await expect(page.getByLabel('대상 ID (고급)')).not.toBeVisible();
    await page.getByRole('button', { name: '이력 조회' }).click();
    const record = page.locator('article').filter({ hasText: name });
    await expect(record).toHaveCount(1);
    await expect(record).toBeVisible();
    await expect(record).toContainText('이전 → 이후');
    await expect(record).toContainText('없음');
    await expect(page.locator('pre')).toHaveCount(0);

    await page.goto('/m/master/rates');
    await expect(page.getByRole('heading', { name: '계약·단가', exact: true })).toBeVisible();
    const cards = page.getByLabel('계약·단가 카드 목록');
    if (width < 768) {
      await expect(cards).toBeVisible();
      await expect(page.getByRole('table')).not.toBeVisible();
      await expect(cards.getByText('최소요금 (원)').first()).toBeVisible();
      await expect(cards.getByText('없음', { exact: true }).first()).toBeVisible();
    } else {
      await expect(cards).not.toBeVisible();
      await expect(page.getByRole('table')).toBeVisible();
      await expect(page.getByRole('table').getByText('없음', { exact: true }).first()).toBeVisible();
    }
    expect(
      await page
        .getByLabel('목록 검색')
        .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
    ).toBeGreaterThanOrEqual(16);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
