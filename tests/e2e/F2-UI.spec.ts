import { expect, test, type Locator, type Page } from '@playwright/test';
import { createDatabase } from '../../src/server/db/client';
import { setupScenario } from '../helpers/factories';
import { createUse, submitUse } from '../../src/server/services/uses';
import { todaySeoul } from '../../src/server/context';

const database = createDatabase(process.env.DATABASE_URL!);
test.afterAll(() => database.pool.end());
test.setTimeout(120000);
async function open(page: Page, driver = false) {
  const s = await setupScenario(database.db);
  const use = await createUse(s.driverCtx, { ...s.input, use_date: todaySeoul(), quantity: '1' });
  await submitUse(s.driverCtx, use.id, { version: use.version });
  await page.request.post('/api/auth/login', {
    data: { login_id: driver ? s.driverUser.login_id : s.admin.login_id, password: 'password1234' },
  });
  await page.goto(driver ? '/d' : '/m/approvals');
  await expect(page.getByRole('group', { name: '운행 진행상태' })).toBeVisible();
  return s;
}
async function selectedFill(group: Locator) {
  const selected = group.locator('[aria-pressed=true]');
  const unselected = group.locator('[aria-pressed=false]').first();
  const style = (element: HTMLElement | SVGElement) => ({
    background: getComputedStyle(element).backgroundColor,
    weight: getComputedStyle(element).fontWeight,
  });
  const active = await selected.evaluate(style);
  const inactive = await unselected.evaluate(style);
  expect(active.background).not.toBe(inactive.background);
  expect(Number(active.weight)).toBeGreaterThanOrEqual(700);
}
for (const driver of [false, true]) {
  test(`${driver ? '기사' : '담당자'} 진행상태 선택은 채움색과 굵기로 구별된다`, async ({ page }) => {
    await open(page, driver);
    const group = page.getByRole('group', { name: '운행 진행상태' });
    await selectedFill(group);
    await group.getByRole('button', { name: /^검수대기/ }).click();
    await selectedFill(group);
  });
}
test('1280·1440px 결재 표와 모든 결재 버튼은 가로 스크롤 없이 보인다', async ({ page }) => {
  await open(page);
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    const table = page.getByLabel('운행 결재 표', { exact: true });
    await expect(table.locator('tbody tr').first()).toBeVisible();
    expect(await table.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await table.locator('thead input, thead select').count()).toBe(0);
    const action = table.getByRole('columnheader', { name: '결재', exact: true });
    expect((await action.boundingBox())!.x + (await action.boundingBox())!.width).toBeLessThanOrEqual(width);
  }
});
test('높이 800px 관리자 메뉴 아래 알림·글자·계정은 메뉴 스크롤에 가리지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.addInitScript(() => Object.defineProperty(Notification, 'permission', { get: () => 'denied' }));
  await open(page);
  const sidebar = page.locator('aside');
  const push = sidebar.getByRole('region', { name: '알림 설정' });
  await expect(push).toContainText('알림이 차단되어 있습니다');
  expect(await push.evaluate((el) => !!el.closest('nav'))).toBe(false);
  for (const size of ['보통', '아주 크게']) {
    await sidebar.getByRole('radio', { name: `글자 ${size}`, exact: true }).click();
    for (const target of [
      push,
      sidebar.getByRole('radiogroup'),
      sidebar.getByRole('button', { name: '로그아웃' }),
    ]) {
      const box = (await target.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(800);
    }
  }
});
test('기사 필터는 접혀 있고 선택한 기간·현장·검색어를 요약하며 360px 큰 글자에서도 넘치지 않는다', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 844 });
  const s = await open(page, true);
  const list = page.locator('section[aria-labelledby="my-uses"]');
  const filters = list.locator('details');
  await expect(filters).not.toHaveAttribute('open');
  await expect(filters.locator('summary')).toContainText('전체 현장');
  await filters.locator('summary').click();
  await filters.getByLabel('프로젝트', { exact: true }).selectOption(s.project.id);
  await filters.getByLabel('운송내역 검색').fill('운반');
  await filters.getByRole('button', { name: '검색', exact: true }).click();
  await page.reload();
  await expect(filters).not.toHaveAttribute('open');
  await expect(filters.locator('summary')).toContainText(s.project.name);
  await expect(filters.locator('summary')).toContainText('운반');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '20px';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('집계·검수함·기사 정산·글자 크기의 선택 채움색과 터치 영역을 유지한다', async ({ page }) => {
  await open(page);
  for (const [path, groupName, names] of [
    ['/m/summary', '포함 기준', ['승인된 금액만', '검수 전 포함']],
    ['/m/summary', '보기 전환', ['현장별', '기사별', '한눈에 표']],
  ] as const) {
    await page.goto(path);
    const group = page.getByRole('group', { name: groupName });
    for (const name of names) {
      await group.getByRole('button', { name, exact: true }).click();
      const selected = group.locator('[aria-pressed=true]');
      await expect(selected).toHaveText(name);
      expect(await selected.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
        await group
          .locator('[aria-pressed=false]')
          .first()
          .evaluate((el) => getComputedStyle(el).backgroundColor),
      );
    }
  }
  await page.goto('/m/review');
  for (const name of ['내 담당만', '전체']) {
    const toggle = page.getByRole('button', { name, exact: true });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  }
  await open(page, true);
  await page.goto('/d/settlements');
  const views = page.getByRole('group', { name: '운행 보기' });
  for (const name of ['현장별', '날짜별']) {
    await views.getByRole('button', { name, exact: true }).click();
    await selectedFill(views);
  }
  const textSizes = page.getByRole('radiogroup', { name: '글자 크기' });
  for (const name of ['보통', '크게', '아주 크게']) {
    const toggle = textSizes.getByRole('radio', { name: `글자 ${name}`, exact: true });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    const box = (await toggle.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
});
