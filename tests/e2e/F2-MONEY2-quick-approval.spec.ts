import { expect, test } from '@playwright/test';
import { createDatabase } from '../../src/server/db/client';
import { setupScenario } from '../helpers/factories';
import { createUse, submitUse, reviewChargeLine, getUse } from '../../src/server/services/uses';

const database = createDatabase(process.env.DATABASE_URL!);
test.afterAll(async () => database.pool.end());
test.setTimeout(90000);
test.use({ actionTimeout: 15000, viewport: { width: 1440, height: 1000 } });
for (const inbox of [true, false]) {
  test(`${inbox ? '검수함' : '운행 결재'}: 청구 확인·보류는 열기, 계약 청구만 선택 승인`, async ({
    page,
  }) => {
    const s = await setupScenario(database.db);
    const manager = await s.f.user({ role: 'SITE_MANAGER' });
    await s.f.assignment(manager.id, s.project.id);
    const customer = await s.f.counterparty({ kind: 'CUSTOMER' });
    await s.f.rate(customer.id, { direction: 'RECEIVABLE', unit_price: 500000 });
    const uses: Awaited<ReturnType<typeof createUse>>[] = [];
    for (const issue of ['difference', 'held', 'matching'] as const) {
      let use = await createUse(s.adminCtx, {
        ...s.input,
        customer_counterparty_id: customer.id,
        charge_lines: [
          { charge_type: 'BASE', direction: 'PAYABLE', requested_amount: 300000 },
          {
            charge_type: 'BASE',
            direction: 'RECEIVABLE',
            requested_amount: issue === 'difference' ? 900000 : 500000,
          },
          ...(issue === 'held'
            ? [{ charge_type: 'TOLL' as const, requested_amount: 50000, reason: '통행료' }]
            : []),
        ],
      });
      use = await submitUse(s.adminCtx, use.id, { version: use.version });
      if (issue === 'held')
        await reviewChargeLine(s.adminCtx, use.charge_lines.find((line) => line.charge_type === 'TOLL')!.id, {
          version: use.version,
          line_review_status: 'HELD',
          reason: '확인 대기',
        });
      uses.push(use);
    }
    expect(
      (
        await page.request.post('/api/auth/login', {
          data: { login_id: manager.login_id, password: 'password1234' },
        })
      ).ok(),
    ).toBe(true);
    await page.goto(inbox ? '/m/review' : '/m/approvals?from=2026-09-01&to=2026-09-30');
    const row = (index: number) =>
      (inbox
        ? page.locator('article')
        : page.getByLabel('운행 결재 표', { exact: true }).locator('tbody tr')
      ).filter({ hasText: uses[index].use_no });
    await expect(row(0)).toContainText('고객 청구 금액 확인 필요');
    await expect(row(1)).toContainText('보류 항목 있음');
    await expect(row(1)).toContainText('지급 300,000원');
    await expect(row(1)).toContainText('보류 지급 50,000원');
    for (const index of [0, 1]) {
      await expect(
        row(index).getByRole('button', { name: inbox ? '바로 승인' : '승인', exact: true }),
      ).toHaveCount(0);
      await expect(row(index).getByRole('checkbox')).toHaveCount(0);
      await expect(row(index).getByRole('link', { name: '열기', exact: true })).toBeVisible();
    }
    await expect(row(2)).toContainText('청구 500,000원');
    if (inbox) await row(2).getByRole('checkbox').check();
    else await page.getByRole('button', { name: '승인 가능 모두 선택', exact: true }).click();
    await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(1);
    await page
      .getByRole('button', { name: /선택.*승인/ })
      .last()
      .click();
    await expect.poll(async () => (await getUse(s.adminCtx, uses[2].id)).review_status).toBe('APPROVED');
    for (const index of [0, 1])
      expect((await getUse(s.adminCtx, uses[index].id)).review_status).toBe('SUBMITTED');
    expect(
      (await getUse(s.adminCtx, uses[2].id)).charge_lines.find((line) => line.direction === 'RECEIVABLE')
        ?.approved_amount,
    ).toBe(500000);
  });
}
