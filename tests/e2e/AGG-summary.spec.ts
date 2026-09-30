import { expect, test, type Page } from '@playwright/test';
import { createDatabase } from '../../src/server/db/client';
import { setupScenario } from '../helpers/factories';
import { createUse, submitUse, approveUse } from '../../src/server/services/uses';

async function prepare() {
  const database = createDatabase(process.env.DATABASE_URL!);
  try {
    const s = await setupScenario(database.db);
    const project = await s.f.project({ name: '집계 두 번째 현장' });
    const driver = await s.f.driver({ name: '집계 두 번째 기사' });
    await s.f.affiliation(driver.id, s.payee.id);
    const manager = await s.f.user({ role: 'SITE_MANAGER' });
    await s.f.assignment(manager.id, s.project.id);
    await s.f.assignment(manager.id, project.id);
    for (const [projectId, driverId, date, quantity] of [
      [s.project.id, s.driver.id, '2026-08-19', '1'],
      [project.id, s.driver.id, '2026-09-18', '2'],
      [s.project.id, driver.id, '2026-09-15', '3'],
    ]) {
      let use = await createUse(s.adminCtx, {
        ...s.input,
        project_id: projectId,
        driver_id: driverId,
        use_date: date,
        quantity,
      });
      use = await submitUse(s.adminCtx, use.id, { version: use.version });
      await approveUse(s.adminCtx, use.id, { version: use.version });
    }
    await createUse(s.adminCtx, { ...s.input, quantity: '1' });
    return { login: manager.login_id, projectId: s.project.id, driverId: s.driver.id };
  } finally {
    await database.pool.end();
  }
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
for (const width of [1440, 390]) {
  test(`${width}px 현장·기사·표, 기간, 대장 연결, 엑셀과 URL 복원`, async ({ page }, testInfo) => {
    const fixture = await prepare();
    await page.setViewportSize({ width, height: 1000 });
    const login = await page.request.post('/api/auth/login', {
      data: { login_id: fixture.login, password: 'password1234' },
    });
    expect(login.status()).toBe(200);
    await page.goto('/m/summary');
    await expect(page.getByRole('heading', { name: '현장·기사별 집계' })).toBeVisible();
    await page.getByLabel('시작일', { exact: true }).fill('2026-08-19');
    await page.getByLabel('종료일', { exact: true }).fill('2026-09-18');
    await page.getByRole('button', { name: '조회하기' }).click();
    const totals = page.locator('[aria-label="집계 요약"]');
    await expect(totals).toContainText('1,800,000원');
    await expect(totals).toContainText('1,980,000원');
    await expect(totals).toContainText('3건');
    await expect(totals).toContainText('2명 · 2곳');
    await expect(page).toHaveURL(/from=2026-08-19&to=2026-09-18/);
    await expect(page.locator('article')).toHaveCount(2);
    await fits(page);
    await page.screenshot({ path: testInfo.outputPath(`projects-${width}.png`), fullPage: true });

    await page.getByRole('button', { name: '기사별', exact: true }).click();
    await expect(page.getByRole('button', { name: '기사별', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('article')).toHaveCount(2);
    await fits(page);
    await page.getByRole('button', { name: '검수 전 포함', exact: true }).click();
    await expect(totals).toContainText('검수 전 300,000원');
    await expect(totals).toContainText('4건');
    await page.screenshot({ path: testInfo.outputPath(`drivers-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: '한눈에 표', exact: true }).click();
    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    await expect(table.locator('tfoot')).toContainText('1,800,000원');
    await expect(table.locator('tfoot')).toContainText('300,000원');
    await page.goBack();
    await expect(page.getByRole('button', { name: '기사별', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: '한눈에 표', exact: true }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: '검수 전 포함', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(table).toBeVisible();
    await expect(page.getByLabel('시작일', { exact: true })).toHaveValue('2026-08-19');
    await fits(page);
    const first = table.locator('thead th').first();
    const before = (await first.boundingBox())!.x;
    await page.getByRole('region', { name: '현장·기사별 금액 표' }).evaluate((element) => {
      element.scrollLeft = 200;
    });
    expect((await first.boundingBox())!.x).toBeCloseTo(before, 0);
    await page.screenshot({ path: testInfo.outputPath(`table-${width}.png`), fullPage: true });

    const response = page.waitForResponse((res) => res.url().includes('/api/summary/export.xlsx'));
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '엑셀로 받기' }).click();
    expect((await response).status()).toBe(200);
    expect((await download).suggestedFilename()).toBe('현장기사별집계_2026-08-19_2026-09-18.xlsx');

    await page.getByRole('button', { name: '현장별', exact: true }).click();
    const link = page.locator(
      `article a[href*="project_id=${fixture.projectId}"][href*="driver_id=${fixture.driverId}"]`,
    );
    await link.click();
    await expect(page).toHaveURL(
      new RegExp(
        `/m/ledger\\?from=2026-08-19&to=2026-09-18&project_id=${fixture.projectId}&driver_id=${fixture.driverId}`,
      ),
    );
    const ledger = await page.request.get(
      `/api/ledger?from=2026-08-19&to=2026-09-18&project_id=${fixture.projectId}&driver_id=${fixture.driverId}`,
    );
    expect((await ledger.json()).data.total).toBe(2);
    if (width < 768) await page.getByRole('button', { name: /^필터.*펼치기/ }).click();
    await expect(page.getByRole('combobox', { name: '기사', exact: true })).toHaveValue(fixture.driverId);
    await expect(page.getByRole('combobox', { name: '현장', exact: true })).toHaveValue(fixture.projectId);
  });
}

test('360px 큰 글자에서도 세 보기 가로 넘침 없음, 빈 결과·오류·재시도·빠른 기간', async ({
  page,
}, testInfo) => {
  const fixture = await prepare();
  await page.setViewportSize({ width: 360, height: 900 });
  await page.request.post('/api/auth/login', { data: { login_id: fixture.login, password: 'password1234' } });
  await page.goto('/m/summary?from=2026-08-19&to=2026-09-18&include=all&view=projects');
  await expect(page.locator('article')).toHaveCount(2);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '20px';
  });
  for (const name of ['현장별', '기사별', '한눈에 표']) {
    await page.getByRole('button', { name, exact: true }).click();
    await fits(page);
  }
  const smallTargets = await page
    .locator('main button, main input, main a')
    .evaluateAll((elements) =>
      elements
        .filter((element) => element.getClientRects().length && element.getBoundingClientRect().height < 44)
        .map((element) => element.textContent),
    );
  expect(smallTargets).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('table-360-large-text.png'), fullPage: true });
  await page.getByLabel('시작일', { exact: true }).fill('2030-01-01');
  await page.getByLabel('종료일', { exact: true }).fill('2030-01-31');
  await page.getByRole('button', { name: '조회하기' }).click();
  await expect(page.getByRole('status')).toContainText('선택한 기간에 해당하는 운행이 없습니다');
  await page.getByLabel('종료일', { exact: true }).fill('2031-02-01');
  await page.getByRole('button', { name: '조회하기' }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('최대 1년');
  await expect(page.getByRole('button', { name: '엑셀로 받기' })).toBeDisabled();
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('최대 1년');
  await page.getByRole('button', { name: '지난달', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
  await expect(page.getByLabel('시작일', { exact: true })).toHaveValue(/-01$/);
  await page.getByRole('button', { name: '이번 달', exact: true }).click();
  await expect(page.getByLabel('시작일', { exact: true })).toHaveValue(/-01$/);
  await fits(page);
});

test('불러오는 중·연결 오류·재시도와 엑셀 오류를 화면에서 안내한다', async ({ page }) => {
  const fixture = await prepare();
  await page.request.post('/api/auth/login', {
    data: { login_id: fixture.login, password: 'password1234' },
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/summary?**', async (route) => {
    await gate;
    await route.abort('failed');
  });
  await page.goto('/m/summary?from=2026-08-19&to=2026-09-18');
  await expect(page.getByRole('status')).toContainText('불러오는 중');
  release();
  await expect(page.locator('main').getByRole('alert')).toContainText('연결');
  await expect(page.locator('article')).toHaveCount(0);
  await page.unroute('**/api/summary?**');
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(page.locator('article')).toHaveCount(2);
  await page.route('**/api/summary/export.xlsx?**', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: '현장 배정을 확인해 주세요.' } }),
    }),
  );
  await page.getByRole('button', { name: '엑셀로 받기' }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('현장 배정을 확인해 주세요.');
  await expect(page.getByRole('button', { name: '엑셀로 받기' })).toBeEnabled();
});
