import { expect, test } from '@playwright/test';
import { createDatabase } from '../../src/server/db/client';
import { setupScenario } from '../helpers/factories';

test.setTimeout(120000);
const database = createDatabase(process.env.DATABASE_URL!);
test.afterAll(() => database.pool.end());
test('PDF 초과 파일은 선택 즉시 거부한다', async ({ page }) => {
  const s = await setupScenario(database.db);
  await page.request.post('/api/auth/login', {
    data: { login_id: s.driverUser.login_id, password: 'password1234' },
  });
  await page.goto('/d/new');
  await page.getByLabel('사진·파일 선택', { exact: true }).setInputFiles({
    name: '큰파일.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.alloc(4 * 1024 * 1024 + 1),
  });
  await expect(page.getByText('4MB 이하 PDF만 올릴 수 있어요', { exact: true })).toBeVisible();
  await expect(page.getByText('큰파일.pdf', { exact: true })).toHaveCount(0);
});
