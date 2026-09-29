import { expect, test } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../../src/server/db/client';
import { factories } from '../helpers/factories';
import { users, projects } from '../../src/server/db/schema';

test('1·4·7. 현장 담당자 가져오기·배정 외 행 오류·중복 의심 개별 제외·미지급 안내', async ({ page }) => {
  const db = createDatabase(process.env.DATABASE_URL!);
  let csv: Buffer;
  try {
    const f = factories(db.db);
    const [site] = await db.db.select().from(users).where(eq(users.login_id, 'site'));
    const allowed = await f.project({ name: 'W7 배정 현장' });
    const outside = await f.project({ name: 'W7 배정 외' });
    await f.assignment(site.id, allowed.id);
    const payee = await f.counterparty();
    const vehicle = await f.vehicle();
    const driver = await f.driver();
    await f.affiliation(driver.id, payee.id);
    const headers = '사용일,현장,기사,차량번호,지급처,출발지,도착지,과금단위,단가';
    const row = (project: typeof projects.$inferSelect) =>
      `2026-09-15,${project.id},${driver.id},${vehicle.id},${payee.id},부산항,서울,일대,300000`;
    csv = Buffer.from([headers, row(allowed), row(outside)].join('\n'));
  } finally {
    await db.pool.end();
  }
  await page.request.post('/api/auth/login', { data: { login_id: 'site', password: 'demo1234' } });
  await page.goto('/m/import');
  await expect(page.getByRole('heading', { name: '엑셀 가져오기' })).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: '주 메뉴' }).getByRole('link', { name: '엑셀 가져오기' }),
  ).toBeVisible();
  await page.getByLabel('가져올 파일').setInputFiles({ name: 'W7.csv', mimeType: 'text/csv', buffer: csv! });
  await page.getByRole('button', { name: '미리보기 검증' }).click();
  await expect(page.getByRole('status').filter({ hasText: '유효 1건 · 오류 1건' })).toBeVisible();
  await page.getByRole('button', { name: '유효 행 임시저장' }).click();
  await expect(page.getByRole('status').filter({ hasText: '1건을 임시저장' })).toBeVisible();
  // Different price means suspected route duplicate, not automatic identical-content skip.
  await page.getByLabel('가져올 파일').setInputFiles({
    name: 'W7-다른금액.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv!.toString().replaceAll('300000', '310000')),
  });
  await page.getByRole('button', { name: '미리보기 검증' }).click();
  await expect(page.getByText('중복 의심:', { exact: false })).toBeVisible();
  await page.getByLabel('2행 제외').check();
  await page.getByRole('button', { name: '미리보기 검증' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: '유효 0건 · 오류 1건 · 건너뜀 1건' }),
  ).toBeVisible();
  await page.goto('/m');
  await expect(page.getByText('정산 담당자 확인')).toBeVisible();
  await expect(page.locator('a[href*="/m/payments"]')).toHaveCount(0);
});
