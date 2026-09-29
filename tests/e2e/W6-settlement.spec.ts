import { test, expect } from '@playwright/test';
import { createDatabase, defaultDatabaseUrl } from '../../src/server/db/client';
import { approved, confirmed, draft, scenario } from '../integration/W4-fixtures';
import { recordPayment } from '../../src/server/services/payments';

let fixture: {
  login: string;
  draftId: string;
  firstUseNo: string;
  secondUseNo: string;
  paidNo: string;
};
test.beforeAll(async () => {
  const { db, pool } = createDatabase(defaultDatabaseUrl());
  try {
    const s = await scenario(db);
    const first = await approved(s);
    const second = await approved(s);
    const statement = await draft(s, [first.charge_lines[0].id]);
    const paidUse = await approved(s);
    const paidStatement = await confirmed(s, [paidUse.charge_lines[0].id]);
    await recordPayment(s.adminCtx, paidStatement.id, {
      client_request_id: crypto.randomUUID(),
      kind: 'PAYMENT',
      amount: paidStatement.grand_total,
      paid_on: '2026-09-29',
      method: '계좌이체',
    });
    fixture = {
      login: s.admin.login_id,
      draftId: statement.id,
      firstUseNo: first.use_no,
      secondUseNo: second.use_no,
      paidNo: paidStatement.statement_no!,
    };
  } finally {
    await pool.end();
  }
});

test('W6 초안 항목 교체와 지급 URL 필터가 새로고침 후에도 적용된다', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('아이디', { exact: true }).fill(fixture.login);
  await page.getByLabel('비밀번호', { exact: true }).fill('password1234');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForURL('/m');
  await page.goto(`/m/statements/${fixture.draftId}`);
  await page.getByRole('button', { name: '추가 후보 조회' }).click();
  await page.getByLabel(`${fixture.secondUseNo} 포함 여부`, { exact: true }).selectOption('INCLUDED');
  await page.getByLabel(`${fixture.firstUseNo} 포함 여부`, { exact: true }).selectOption('EXCLUDED');
  await page.getByRole('button', { name: '초안 변경 저장' }).click();
  await expect(page.getByLabel(`${fixture.firstUseNo} 포함 여부`, { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel(`${fixture.secondUseNo} 포함 여부`, { exact: true })).toHaveValue('INCLUDED');
  await expect(page.getByLabel(`${fixture.firstUseNo} 포함 여부`, { exact: true })).toHaveCount(0);

  for (const query of ['state=PAID', 'status=PAID', 'state=PAID&status=UNPAID']) {
    await page.goto(`/m/payments?${query}`);
    await expect(page.getByLabel('조회 상태')).toHaveValue('PAID');
    await expect(page.getByRole('link', { name: fixture.paidNo, exact: true })).toBeVisible();
  }
});
