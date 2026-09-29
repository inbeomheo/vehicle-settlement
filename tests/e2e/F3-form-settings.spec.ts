import { expect, test, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../../src/server/db/client';
import { vehicleUses } from '../../src/server/db/schema';
import { setupScenario } from '../helpers/factories';
import { saveFormSettings } from '../../src/server/services/form-settings';
import { getUse } from '../../src/server/services/uses';

const database = createDatabase(process.env.DATABASE_URL!);
test.use({ viewport: { width: 390, height: 844 }, actionTimeout: 15000 });
test.setTimeout(120000);
test.afterAll(async () => database.pool.end());
async function login(page: Page, login_id: string, path = '/d/new') {
  await page.request.post('/api/auth/login', { data: { login_id, password: 'password1234' } });
  await page.goto(path);
}

for (const action of ['수정', '삭제'] as const) {
  test(`열린 기사 폼의 미완성 추가비를 숨겨도 ${action} 후 저장·제출할 수 있다`, async ({ page }) => {
    const s = await setupScenario(database.db);
    await login(page, s.driverUser.login_id);
    await page.getByLabel('1회차 출발', { exact: true }).fill('창고');
    await page.getByLabel('1회차 도착', { exact: true }).fill('현장');
    await page.getByRole('button', { name: '+ 추가 비용', exact: true }).click();
    await page.getByLabel('추가비 1 요청액 (원)', { exact: true }).fill('1200');
    await saveFormSettings(s.adminCtx, {
      project_id: s.project.id,
      fields: [{ field_key: 'extra_charges', driver_mode: 'HIDDEN', manager_mode: 'HIDDEN', version: 0 }],
    });
    await page.getByRole('button', { name: '담당자에게 제출', exact: true }).click();
    await expect(page.locator('#form-errors')).toContainText(
      '추가 비용은 정수 원 요청액과 사유를 입력하세요.',
    );
    await expect(page.getByLabel('추가비 1 요청액 (원)', { exact: true })).toHaveValue('1200');
    await expect(page.getByText('관리자 설정상 숨김 항목입니다', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '+ 추가 비용', exact: true })).toHaveCount(0);
    if (action === '수정') {
      await page.getByLabel('추가비 1 사유', { exact: true }).fill('통행료');
    } else {
      await page.getByRole('button', { name: '추가 비용 삭제', exact: true }).click();
    }
    await page.getByRole('button', { name: '서버 저장', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('서버 저장(작성중)');
    await page.getByRole('button', { name: '담당자에게 제출', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('담당자에게 제출 완료');
    const [row] = await database.db.select().from(vehicleUses).where(eq(vehicleUses.driver_id, s.driver.id));
    const use = await getUse(s.driverCtx, row.id);
    expect(use.charge_lines.filter((line) => line.charge_type === 'TOLL')).toHaveLength(
      action === '수정' ? 1 : 0,
    );
    if (action === '수정')
      expect(use.charge_lines.find((line) => line.charge_type === 'TOLL')).toMatchObject({
        requested_amount: 1200,
        reason: '통행료',
      });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  });
}
