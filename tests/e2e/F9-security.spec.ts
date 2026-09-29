import { test, expect } from '@playwright/test';
import { createDatabase } from '../../src/server/db/client';
import { approved, confirmed, scenario } from '../integration/W4-fixtures';

let fixture: { login: string; statementId: string; driver: string };
test.beforeAll(async () => {
  const { db, pool } = createDatabase(process.env.DATABASE_URL!);
  try {
    const s = await scenario(db);
    const use = await approved(s);
    const statement = await confirmed(s, [use.charge_lines[0].id]);
    fixture = { login: s.admin.login_id, statementId: statement.id, driver: s.driverUser.login_id };
  } finally {
    await pool.end();
  }
});
test('보안 헤더를 적용해도 로그인·기사 촬영·PWA·PDF 다운로드가 작동', async ({ page }) => {
  for (const path of ['/login', '/manifest.webmanifest', '/sw.js', '/icons/icon-512.png']) {
    const response = await page.request.get(path);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-security-policy']).toBe("frame-ancestors 'none'");
    expect(response.headers()['x-frame-options']).toBe('DENY');
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(response.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(response.headers()['permissions-policy']).toContain('camera=(self)');
  }
  await page.goto('/login');
  await page.getByLabel('아이디', { exact: true }).fill(fixture.driver);
  await page.getByLabel('비밀번호', { exact: true }).fill('password1234');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page).toHaveURL('/d');
  await page.goto('/d/new');
  await expect(page.getByLabel('사진·파일 선택', { exact: true })).toBeAttached();
  const cameraAllowed = await page.evaluate(() => {
    const policy = (document as Document & { featurePolicy?: { allowsFeature(name: string): boolean } })
      .featurePolicy;
    return policy?.allowsFeature('camera');
  });
  expect(cameraAllowed).toBe(true);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.request.post('/api/auth/logout');
  expect(
    (
      await page.request.post('/api/auth/login', {
        data: { login_id: fixture.login, password: 'password1234' },
      })
    ).ok(),
  ).toBe(true);
  const pdf = await page.request.get(`/api/statements/${fixture.statementId}/export.pdf`);
  expect(pdf.ok()).toBe(true);
  expect(pdf.headers()['content-type']).toContain('application/pdf');
  expect(pdf.headers()['x-content-type-options']).toBe('nosniff');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
});
