import { expect, test } from '@playwright/test';
import { createDatabase } from '../../src/server/db/client';
import { setupScenario } from '../helpers/factories';

test.setTimeout(120000);
const database = createDatabase(process.env.DATABASE_URL!);
test.afterAll(() => database.pool.end());
test('가져오기 화면은 전체 집계와 표시한 행 수를 구분한다', async ({ page }) => {
  const s = await setupScenario(database.db);
  await page.request.post('/api/auth/login', {
    data: { login_id: s.admin.login_id, password: 'password1234' },
  });
  const row = `2026-09-15,${s.project.id},${s.driver.id},${s.vehicle.id},${s.payee.id},부산,서울,일대,300000`;
  await page.goto('/m/import');
  await page.getByLabel('가져올 파일').setInputFiles({
    name: '101행.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      ['사용일,현장,기사,차량번호,지급처,출발지,도착지,과금단위,단가', ...Array(101).fill(row)].join('\n'),
    ),
  });
  await page.getByRole('button', { name: '미리보기 검증', exact: true }).click();
  await expect(page.getByText('전체 101행 · 경고 0행 · 현재 100행 표시', { exact: false })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '유효 101건' })).toBeVisible();
  await expect(page.getByLabel('102행 제외', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '다음 100행' }).click();
  await expect(page.getByLabel('102행 제외', { exact: true })).toBeVisible();
  await expect(page.getByText('전체 101행 · 경고 0행 · 현재 1행 표시', { exact: false })).toBeVisible();
});
