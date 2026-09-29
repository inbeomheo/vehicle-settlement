import { test, expect, type Page } from '@playwright/test';
import { createDatabase, defaultDatabaseUrl } from '../../src/server/db/client';
import { approved, confirmed, scenario } from '../integration/W4-fixtures';
import { recordPayment } from '../../src/server/services/payments';

type Fixture = { login: string; partyId: string; paidNo: string; useNo: string };
const fixtures = new Map<number, Fixture>();
const widths = [360, 390, 1440];

test.beforeAll(async () => {
  const { db, pool } = createDatabase(defaultDatabaseUrl());
  try {
    for (const width of widths) {
      const s = await scenario(db);
      const manager = await s.f.user({ role: 'SETTLEMENT_MANAGER' });
      await s.f.assignment(manager.id, s.project.id);
      const use = await approved(
        s,
        {
          charge_lines: [
            { charge_type: 'BASE', billing_unit: 'PER_DAY' },
            { charge_type: 'TOLL', billing_unit: 'PER_DAY', requested_amount: 5000, reason: '통행 영수증' },
          ],
        },
        'TAX_EXEMPT',
      );
      const paidUse = await approved(s);
      const paid = await confirmed(s, [paidUse.charge_lines[0].id]);
      await recordPayment(s.adminCtx, paid.id, {
        client_request_id: crypto.randomUUID(),
        kind: 'PAYMENT',
        amount: paid.grand_total,
        paid_on: '2026-09-29',
        method: '계좌이체',
      });
      fixtures.set(width, {
        login: manager.login_id,
        partyId: s.payee.id,
        paidNo: paid.statement_no!,
        useNo: use.use_no,
      });
    }
  } finally {
    await pool.end();
  }
});

async function assertFits(page: Page, mobile: boolean) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const tooSmall = await page.locator('main input, main select, main textarea').evaluateAll(
    (elements) =>
      elements.filter((element) => {
        if (!(element instanceof HTMLElement) || element.offsetParent === null) return false;
        return parseFloat(getComputedStyle(element).fontSize) < 16;
      }).length,
  );
  expect(tooSmall).toBe(0);
  if (mobile) {
    const overflowing = await page
      .locator('main table')
      .evaluateAll((elements) =>
        elements.some((element) => element.getBoundingClientRect().right > window.innerWidth),
      );
    expect(overflowing).toBe(false);
  }
}

for (const width of widths) {
  test(`W8b ${width}px 정산 후보·명세 카드와 2단계 확정·사유 취소·지급 완료 요약`, async ({ page }) => {
    const fixture = fixtures.get(width)!;
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/login');
    await page.getByLabel('아이디', { exact: true }).fill(fixture.login);
    await page.getByLabel('비밀번호', { exact: true }).fill('password1234');
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await page.waitForURL('/m');
    await page.goto('/m/statements');
    await expect(page.getByRole('link', { name: fixture.paidNo, exact: true })).toBeVisible();
    await assertFits(page, width < 768);
    await page.getByRole('button', { name: '새 정산', exact: true }).click();
    await page.getByLabel('거래처', { exact: true }).selectOption(fixture.partyId);
    await page.getByLabel('기간 시작', { exact: true }).fill('2026-09-01');
    await page.getByLabel('기간 종료', { exact: true }).fill('2026-09-30');
    await page.getByRole('button', { name: '후보 조회', exact: true }).click();
    const tollCandidate = page
      .locator('tbody tr')
      .filter({ hasText: fixture.useNo })
      .filter({ hasText: '통행료' });
    await expect(tollCandidate).toContainText('건 · 수량');
    await assertFits(page, width < 768);
    await page.getByRole('button', { name: '초안 만들기', exact: true }).click();
    await page.waitForURL(/\/m\/statements\/[0-9a-f-]+$/);
    const id = page.url().split('/').at(-1)!;
    const tollItem = page.locator('tbody tr').filter({ hasText: '통행료' });
    await expect(tollItem).toContainText('건');
    await expect(tollItem).toContainText('5,000원');
    await assertFits(page, width < 768);
    await page.getByRole('button', { name: '명세 확정', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: '명세 확정 확인', exact: true });
    await expect(confirmation).toContainText('포함 2건 · 총액 305,000원');
    expect((await (await page.request.get(`/api/statements/${id}`)).json()).data.status).toBe('DRAFT');
    await confirmation.getByRole('button', { name: '돌아가기', exact: true }).click();
    await expect(page.getByRole('heading', { name: '작성 중 명세', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '명세 확정', exact: true }).click();
    await confirmation.getByRole('button', { name: '확정', exact: true }).click();
    await expect(page.getByRole('heading', { name: /^PAY-202609-/ })).toBeVisible();
    await page.getByRole('button', { name: '명세 취소', exact: true }).click();
    expect((await (await page.request.get(`/api/statements/${id}`)).json()).data.status).toBe('CONFIRMED');
    await page.getByLabel('명세 취소 사유', { exact: true }).fill('거래처 확인 후 재작성');
    await page.getByRole('button', { name: '명세 취소 확인', exact: true }).click();
    await expect(page.getByText('취소 사유: 거래처 확인 후 재작성', { exact: false })).toBeVisible();
    await page.goto('/m/payments?state=PAID');
    await expect(
      page.getByRole('heading', { name: '거래처·현장별 지급 완료 내역', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: fixture.paidNo, exact: true })).toBeVisible();
    await expect(page.getByText('해당 조건의 지급 완료 내역이 없습니다.', { exact: true })).toHaveCount(0);
    await assertFits(page, width < 768);
    await page.getByRole('button', { name: '청구', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '거래처·현장별 입금 완료 내역', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('해당 조건의 입금 완료 내역이 없습니다.', { exact: true }).first(),
    ).toBeVisible();
  });
}
