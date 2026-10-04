import { eq } from 'drizzle-orm';
import { counterparties } from '../../src/server/db/schema';
import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { createDatabase } from '../../src/server/db/client';
import { setupScenario } from '../helpers/factories';
import { createUse, submitUse, approveUse } from '../../src/server/services/uses';
import { createJoinLink } from '../../src/server/services/driver-join';
import { createInvite } from '../../src/server/services/auth';

async function prepare() {
  const db = createDatabase(process.env.DATABASE_URL!);
  try {
    const s = await setupScenario(db.db);
    await db.db
      .update(counterparties)
      .set({ name: `시연거래처-${s.payee.id}` })
      .where(eq(counterparties.id, s.payee.id));
    let use = await createUse(s.adminCtx, { ...s.input, quantity: '1' });
    use = await submitUse(s.adminCtx, use.id, { version: use.version });
    await approveUse(s.adminCtx, use.id, { version: use.version });
    const link = await createJoinLink(s.adminCtx, { project_ids: [s.project.id] });
    const invite = await createInvite(s.adminCtx, {
      role: 'DRIVER',
      name: '시연 기사',
      project_ids: [s.project.id],
    });
    return {
      login: s.admin.login_id,
      project: s.project.id,
      payee: s.payee.id,
      join: new URL(link.join_url).pathname,
      invite: new URL(invite.invite_url).pathname,
    };
  } finally {
    await db.pool.end();
  }
}

test('관리자 거래처 입력 후 거래명세표 다운로드 머리 확인', async ({ page }) => {
  const s = await prepare();
  await page.request.post('/api/auth/login', { data: { login_id: s.login, password: 'password1234' } });
  await page.goto('/m/master/counterparties');
  await page.getByLabel('목록 검색', { exact: true }).fill(s.payee);
  await page.getByRole('button', { name: '수정', exact: true }).click();
  await page.getByLabel('대표자', { exact: true }).fill('시연 대표');
  await page.getByLabel('사업장 주소', { exact: true }).fill('시연시 시험로 123');
  await page.getByLabel('업태', { exact: true }).fill('운수');
  await page.getByLabel('종목', { exact: true }).fill('화물');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByText('저장했습니다.', { exact: true })).toBeVisible();
  await page.goto(
    `/m/summary?from=2026-09-01&to=2026-09-30&project_id=${s.project}&payee_counterparty_id=${s.payee}`,
  );
  await page.getByRole('button', { name: '자세히 보기', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page
    .getByRole('region', { name: '운행 상세', exact: true })
    .getByRole('button', { name: '거래명세표 엑셀', exact: true })
    .click();
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile((await (await downloading).path())!);
  const sheet = book.worksheets[0];
  expect(sheet.getCell('C6').text).toBe('시연 대표');
  expect(sheet.getCell('C7').text).toBe('시연시 시험로 123');
  expect(sheet.getCell('C8').text).toBe('운수 / 화물');
});

for (const route of ['join', 'invite'] as const)
  test(`360px ${route} 새 사업자 선택 입력 기본값`, async ({ page }) => {
    const s = await prepare();
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(s[route]);
    await expect(page.getByLabel('업태 (선택)', { exact: true })).toHaveValue('운수');
    await expect(page.getByLabel('종목 (선택)', { exact: true })).toHaveValue('화물');
    await expect(page.getByLabel('대표자 (선택)', { exact: true })).toBeEmpty();
    await expect(page.getByLabel('사업장 주소 (선택)', { exact: true })).toBeEmpty();
    expect(
      await page.getByLabel('대표자 (선택)', { exact: true }).evaluate((el: HTMLInputElement) => el.required),
    ).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

test('설명서 웹·PDF의 거래처와 회사 정보 보완 안내', async ({ page }) => {
  await page.goto('/manual');
  await expect(page.locator('main')).toContainText('대표자·사업장 주소·업태·종목을 선택 입력');
  await expect(page.locator('main')).toContainText('등록된 대표자·사업장 주소·업태·종목이 공급자 칸에');
  const { extractPdfText } = await import('../helpers/pdf');
  const pdf = await page.request.get('/manual/vehicle-manual.pdf');
  const text = extractPdfText(await pdf.body()).replace(/\s+/g, ' ');
  expect(text).toContain('대표자·사업장 주소·업태·종목을 선택 입력');
  expect(text).toContain('등록된 대표자·사업장 주소·업태·종목이 공급자 칸에');
});
