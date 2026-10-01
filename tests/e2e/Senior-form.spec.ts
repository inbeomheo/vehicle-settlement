import { fillFlowFields } from './submit-helper';
import { expect, test, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../../src/server/db/client';
import { vehicleUses } from '../../src/server/db/schema';
import { setupScenario } from '../helpers/factories';

const database = createDatabase(process.env.DATABASE_URL!);
// 시니어 기준: 360px 휴대폰에서 글자 "아주 크게"(20px)로 사용한다.
test.use({ viewport: { width: 360, height: 780 }, actionTimeout: 15000 });
test.afterAll(async () => database.pool.end());

async function login(page: Page, loginId: string, path: string) {
  await page.addInitScript(() => localStorage.setItem('vehicle-text-size', 'xlarge'));
  await page.request.post('/api/auth/login', { data: { login_id: loginId, password: 'password1234' } });
  await page.goto(path);
  await expect(page.getByRole('button', { name: '서버 저장', exact: true })).toBeEnabled();
}

test('번호 단계·보내기 전 확인 시트(Esc·고치기)·보낸 뒤 결과 화면', async ({ page }) => {
  const s = await setupScenario(database.db);
  await login(page, s.driverUser.login_id, `/d/new?project=${s.project.id}`);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('20px');

  // 순서가 보이는 단계 제목과 완료 표시
  for (const title of ['프로젝트·운행일', '담당자·적재용량', '출발 → 도착', '요금 확인'])
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  // 새 현장 기본 증빙 정책은 '증빙 선택'이라 제목에 (선택)이 붙는다.
  await expect(page.getByRole('heading', { name: '사진·증빙 (선택)', exact: true })).toBeVisible();
  const site = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: '프로젝트·운행일' }) });
  await expect(site.getByText('완료', { exact: true })).toBeVisible();
  const route = page.locator('section').filter({ has: page.getByRole('heading', { name: '출발 → 도착' }) });
  await expect(route.getByText('완료', { exact: true })).toHaveCount(0);
  await page.getByLabel('1회차 출발', { exact: true }).fill('창고');
  await page.getByLabel('1회차 도착', { exact: true }).fill('현장');
  await expect(route.getByText('완료', { exact: true })).toBeVisible();

  const submit = page.getByRole('button', { name: '담당자에게 보내기', exact: true });
  const sheet = page.getByRole('dialog', { name: '이대로 보낼까요?' });

  // Esc 로 닫으면 아무것도 보내지 않고 누른 버튼으로 초점이 돌아온다.
  await fillFlowFields(page);
  await submit.click();
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: '보내기', exact: true })).toBeFocused();
  await expect(sheet).toContainText(s.project.name);
  await expect(sheet).toContainText('창고 → 현장');
  await expect(sheet).toContainText('사진·증빙');
  await expect(sheet).toContainText('예상 금액');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(submit).toBeFocused();

  // 고치기도 닫기만 한다.
  await fillFlowFields(page);
  await submit.click();
  await sheet.getByRole('button', { name: '고치기', exact: true }).click();
  await expect(sheet).toBeHidden();
  const before = await database.db.select().from(vehicleUses).where(eq(vehicleUses.driver_id, s.driver.id));
  expect(before.every((row) => row.review_status !== 'SUBMITTED')).toBe(true);

  // 보내기 → 결과 화면이 맨 위에 크게 보인다.
  await fillFlowFields(page);
  await submit.click();
  await sheet.getByRole('button', { name: '보내기', exact: true }).click();
  await expect(page).toHaveURL(/\/d\/uses\/[\w-]+\?submitted=1/);
  await expect(page.getByRole('heading', { name: '보냈습니다', exact: true })).toBeInViewport();
  await expect(page.getByRole('status')).toHaveText('담당자에게 보냈습니다');
  await expect(page.getByRole('link', { name: '내 운행으로', exact: true })).toBeVisible();
  const [row] = await database.db.select().from(vehicleUses).where(eq(vehicleUses.driver_id, s.driver.id));
  expect(row.review_status).toBe('SUBMITTED');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

test('입력 오류가 있으면 확인 시트를 열지 않고 해당 칸으로 안내한다', async ({ page }) => {
  const s = await setupScenario(database.db);
  await login(page, s.driverUser.login_id, `/d/new?project=${s.project.id}`);
  await fillFlowFields(page);
  await page.getByRole('button', { name: '담당자에게 보내기', exact: true }).click();
  await expect(page.getByLabel('1회차 출발', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('dialog', { name: '이대로 보낼까요?' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});
