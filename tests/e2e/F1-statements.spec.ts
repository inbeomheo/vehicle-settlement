import { expect, test } from '@playwright/test';
import { createDatabase } from '../../src/server/db/client';
import { approved, draft, scenario } from '../integration/W4-fixtures';

let fixture: { login: string; statementId: string; useId: string; lineId: string; version: number };
test.beforeAll(async () => {
  const { db, pool } = createDatabase(process.env.DATABASE_URL!);
  try {
    const s = await scenario(db);
    const use = await approved(s);
    const statement = await draft(s, [use.charge_lines[0].id]);
    fixture = {
      login: s.admin.login_id,
      statementId: statement.id,
      useId: use.id,
      lineId: use.charge_lines[0].id,
      version: use.version,
    };
  } finally {
    await pool.end();
  }
});

test('확정 확인 중 금액 변경 시 최신 내역을 보여주고 다시 확인해야 한다', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { login_id: fixture.login, password: 'password1234' } });
  await page.goto(`/m/statements/${fixture.statementId}`);
  await page.getByRole('button', { name: '명세 확정', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '명세 확정 확인' });
  await expect(confirmation).toContainText('300,000원');
  const changed = await page.request.patch(`/api/uses/${fixture.useId}`, {
    data: {
      version: fixture.version,
      charge_lines: [{ id: fixture.lineId, charge_type: 'BASE', billing_unit: 'PER_DAY', quantity: '2' }],
    },
  });
  expect(changed.status()).toBe(200);
  const use = (await changed.json()).data;
  expect(
    (
      await page.request.post(`/api/uses/${fixture.useId}/approve`, { data: { version: use.version } })
    ).status(),
  ).toBe(200);
  const rejection = page.waitForResponse((response) => response.url().endsWith('/confirm'));
  await confirmation.getByRole('button', { name: '확정', exact: true }).click();
  expect((await rejection).status()).toBe(409);
  await expect(page.locator('main').getByRole('alert')).toContainText('명세 내용이 변경되었습니다');
  await expect(confirmation).toHaveCount(0);
  await expect(page.getByText('확정 시 부여', { exact: true })).toBeVisible();
  await expect(page.locator('main')).toContainText('600,000원');
  expect((await (await page.request.get(`/api/statements/${fixture.statementId}`)).json()).data.status).toBe(
    'DRAFT',
  );
  await page.getByRole('button', { name: '명세 확정', exact: true }).click();
  await expect(confirmation).toContainText('600,000원');
  await confirmation.getByRole('button', { name: '확정', exact: true }).click();
  await expect(page.getByText(/^PAY-202609-\d+$/)).toBeVisible();
});
