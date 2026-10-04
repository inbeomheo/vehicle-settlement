import { test, expect } from '@playwright/test';
import { createDatabase } from '../../src/server/db/client';
import { setupScenario } from '../helpers/factories';
import { createUse, submitUse, approveUse } from '../../src/server/services/uses';

async function prepare() {
  const db = createDatabase(process.env.DATABASE_URL!);
  try {
    const s = await setupScenario(db.db);
    let use = await createUse(s.adminCtx, { ...s.input, quantity: '1', cargo_desc: '시연 자재' });
    use = await submitUse(s.adminCtx, use.id, { version: use.version });
    await approveUse(s.adminCtx, use.id, { version: use.version });
    return { login: s.admin.login_id, project: s.project.id, payee: s.payee.id };
  } finally {
    await db.pool.end();
  }
}
for (const width of [1440, 390])
  test(`${width}px 상세 목록·합계·필터·엑셀·URL 복원`, async ({ page }) => {
    const s = await prepare();
    await page.setViewportSize({ width, height: 1000 });
    await page.request.post('/api/auth/login', { data: { login_id: s.login, password: 'password1234' } });
    await page.goto(`/m/summary?from=2026-09-01&to=2026-09-30&project_id=${s.project}`);
    await page.getByLabel('지급처', { exact: true }).selectOption(s.payee);
    await page.getByRole('button', { name: '자세히 보기', exact: true }).click();
    const detail = page.getByRole('region', { name: '운행 상세', exact: true });
    await expect(detail).toContainText('시연 자재');
    await expect(detail).toContainText('330,000원');
    await expect(detail.getByRole('columnheader', { name: '기사명', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/detail=project/);
    await page.reload();
    await expect(detail).toContainText('시연 자재');
    const download = page.waitForEvent('download');
    await detail.getByRole('button', { name: '거래명세표 엑셀', exact: true }).click();
    expect((await download).suggestedFilename()).toMatch(/^거래명세표_.*\.xlsx$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await detail.getByLabel('정렬', { exact: true }).selectOption('driver');
    await expect(page).toHaveURL(/sort=driver/);
    await page.getByRole('button', { name: '상세 닫기' }).click();
    await page.getByRole('button', { name: '기사별', exact: true }).click();
    await page.getByRole('button', { name: '자세히 보기', exact: true }).click();
    await expect(detail).toContainText('테스트 현장');
  });
for (const width of [1280, 1440])
  test(`${width}px 기사관리 표는 관리 버튼까지 가로 스크롤 없이 표시`, async ({ page }) => {
    const s = await prepare();
    await page.setViewportSize({ width, height: 1000 });
    await page.request.post('/api/auth/login', { data: { login_id: s.login, password: 'password1234' } });
    await page.goto('/m/drivers');
    const table = page.getByRole('table');
    await expect(table.getByRole('button', { name: '현장 배정', exact: true }).first()).toBeVisible();
    expect(await table.evaluate((el) => el.parentElement!.scrollWidth <= el.parentElement!.clientWidth)).toBe(
      true,
    );
    const buttons = table.locator('tbody tr').first().locator('td').last().getByRole('button');
    await expect(buttons).toHaveCount(6);
    await expect(buttons.filter({ hasText: '삭제' })).toHaveCount(1);
    for (const button of await buttons.all()) {
      const rect = (await button.boundingBox())!;
      expect(rect.x + rect.width).toBeLessThanOrEqual(width);
    }
  });

test('설명서 웹·PDF에 상세 조회와 거래명세표 안내가 있다', async ({ page }) => {
  await page.goto('/manual');
  await expect(page.locator('main')).toContainText('카드의 금액 아래 자세히 보기');
  await expect(page.locator('main')).toContainText('거래명세표 엑셀');
  const image = page.getByRole('img', { name: '현장 상세 운행 목록과 거래명세표 엑셀', exact: true });
  await image.scrollIntoViewIfNeeded();
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth === 1440))
    .toBe(true);
  const response = await page.request.get('/manual/vehicle-manual.pdf');
  const { extractPdfText } = await import('../helpers/pdf');
  const text = extractPdfText(await response.body()).replace(/\s+/g, ' ');
  expect(text).toContain('카드의 금액 아래 자세히 보기');
  expect(text).toContain('거래명세표 엑셀');
});
