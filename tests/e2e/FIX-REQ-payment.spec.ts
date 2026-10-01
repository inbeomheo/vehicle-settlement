import { expect, test, type Page } from '@playwright/test';
import { createDatabase } from '../../src/server/db/client';
import { scenario, approved, confirmed } from '../integration/W4-fixtures';
const database = createDatabase(process.env.DATABASE_URL!);
test.afterAll(() => database.pool.end());
test.setTimeout(90000);
async function login(page: Page, login_id: string) {
  expect(
    (await page.request.post('/api/auth/login', { data: { login_id, password: 'password1234' } })).ok(),
  ).toBe(true);
}
test('지급 기록은 명세 전액을 버튼·확인 문구에 표시하고 한 번만 저장한다', async ({ page }) => {
  const s = await scenario(database.db);
  const use = await approved(
    s,
    { charge_lines: [{ charge_type: 'BASE', quantity: '1', requested_amount: 250000 }] },
    'VAT_EXCLUDED',
  );
  const statement = await confirmed(
    s,
    use.charge_lines.map((l) => l.id),
  );
  await login(page, s.admin.login_id);
  await page.goto(`/m/statements/${statement.id}`);
  await expect(
    page.getByText('명세 전액 275,000원을 모두 지급했는지 확인하세요.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '275,000원 지급 완료로 기록', exact: true }).click();
  await expect(page.getByRole('button', { name: '오입력 취소', exact: true })).toBeVisible();
  const data = (await (await page.request.get(`/api/statements/${statement.id}`)).json()).data;
  expect(data.payments).toHaveLength(1);
  expect(data.payments[0].amount).toBe(275000);
});
