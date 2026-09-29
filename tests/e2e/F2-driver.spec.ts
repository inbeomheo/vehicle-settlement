import { expect, test, type Page } from '@playwright/test';
import { createDatabase } from '../../src/server/db/client';
import { setupScenario } from '../helpers/factories';
import { approveUse, createUse, getUse, submitUse } from '../../src/server/services/uses';
import { createStatement, confirmStatement } from '../../src/server/services/statements';

const database = createDatabase(process.env.DATABASE_URL!);
test.use({ viewport: { width: 390, height: 844 }, actionTimeout: 15000 });
test.setTimeout(90000);
test.afterAll(async () => database.pool.end());
async function login(page: Page, login_id: string, id: string) {
  await page.request.post('/api/auth/login', { data: { login_id, password: 'password1234' } });
  await page.goto(`/d/uses/${id}`);
}
async function approvedProxy() {
  const s = await setupScenario(database.db);
  let use = await createUse(s.adminCtx, s.input);
  use = await submitUse(s.adminCtx, use.id, { version: use.version });
  use = await approveUse(s.adminCtx, use.id, { version: use.version });
  return { s, use };
}
async function lock({ s, use }: Awaited<ReturnType<typeof approvedProxy>>) {
  const statement = await createStatement(s.adminCtx, {
    client_request_id: crypto.randomUUID(),
    direction: 'PAYABLE',
    counterparty_id: s.payee.id,
    period_start: '2026-09-01',
    period_end: '2026-09-30',
    items: [{ charge_line_id: use.charge_lines[0].id }],
  });
  await confirmStatement(s.adminCtx, statement.id, {
    version: statement.version,
    confirmation_token: statement.confirmation_token!,
  });
}

test('정산 잠금으로 막힌 미전송 초안을 읽기 전용에서 취소·폐기하고 집계와 로그아웃 경고를 해소한다', async ({
  page,
}) => {
  const fixture = await approvedProxy();
  const { s, use } = fixture;
  await login(page, s.driverUser.login_id, use.id);
  await page.getByRole('button', { name: '수정하기', exact: true }).click();
  await page.getByRole('button', { name: '확인 후 수정' }).click();
  await page.getByLabel('운반 내용', { exact: true }).fill('폐기할 로컬 변경');
  await lock(fixture);
  const before = await getUse(s.adminCtx, use.id);
  await page.getByRole('button', { name: '서버 저장', exact: true }).click();
  await expect(page.locator('#form-errors')).toContainText('담당자에게 문의하세요');
  await page.reload();
  await expect(page.locator('input,select,textarea')).toHaveCount(0);
  await page.getByRole('button', { name: '이 기기의 미전송 초안 폐기', exact: true }).click();
  await expect(page.getByRole('alertdialog', { name: '기기 초안 폐기 확인' })).toContainText(
    '이미 서버에 저장된 운행과 증빙은 유지됩니다',
  );
  await page.getByRole('button', { name: '계속 작성', exact: true }).click();
  await page.goto('/d');
  await expect(page.getByText('기기 미전송').locator('..')).toContainText('1건');
  await page.goto(`/d/uses/${use.id}`);
  await page.getByRole('button', { name: '이 기기의 미전송 초안 폐기', exact: true }).click();
  await page.getByRole('button', { name: '기기 초안 폐기 확인', exact: true }).click();
  await expect(page).toHaveURL(/\/d$/);
  await expect(page.getByText('기기 미전송').locator('..')).toContainText('0건');
  expect(await getUse(s.adminCtx, use.id)).toEqual(before);
  const dialogs: string[] = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(dialogs).toEqual([]);
});

for (const locked of [false, true]) {
  test(`대리 입력 내용 확인은 ${locked ? '정산 확정' : '승인'} 읽기 전용에서도 가능하다`, async ({
    page,
  }) => {
    const fixture = await approvedProxy();
    const { s, use } = fixture;
    if (locked) await lock(fixture);
    const before = await getUse(s.adminCtx, use.id);
    await login(page, s.driverUser.login_id, use.id);
    await expect(page.locator('input,select,textarea')).toHaveCount(0);
    await page.getByRole('button', { name: '내용 확인', exact: true }).click();
    await expect(page.getByText('기사가 내용을 확인했습니다.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '내용 확인', exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText('기사가 내용을 확인했습니다.', { exact: true })).toBeVisible();
    const after = await getUse(s.adminCtx, use.id);
    expect(after.driver_confirmed_at).not.toBeNull();
    expect(after.review_status).toBe('APPROVED');
    expect(after.charge_lines).toEqual(before.charge_lines);
    expect(after.approved_revision_id).toBe(before.approved_revision_id);
    expect(after.is_locked).toBe(locked);
  });
}
