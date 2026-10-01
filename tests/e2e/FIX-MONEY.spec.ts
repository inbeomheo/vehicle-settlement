import { expect, test, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../../src/server/db/client';
import { rateAgreements, users } from '../../src/server/db/schema';
import { setupScenario } from '../helpers/factories';
import { confirmed } from '../integration/W4-fixtures';
import { createUse, submitUse, approveUse, updateUse, getUse } from '../../src/server/services/uses';
const database = createDatabase(process.env.DATABASE_URL!);
test.afterAll(async () => database.pool.end());
test.setTimeout(90000);
test.use({ actionTimeout: 10000 });
async function login(page: Page, id: string, path: string) {
  expect(
    (await page.request.post('/api/auth/login', { data: { login_id: id, password: 'password1234' } })).ok(),
  ).toBe(true);
  await page.goto(path);
}
async function submitted(
  s: Awaited<ReturnType<typeof setupScenario>>,
  amount = 300000,
  projectId = s.project.id,
) {
  const use = await createUse(s.driverCtx, {
    ...s.input,
    project_id: projectId,
    charge_lines: [{ charge_type: 'BASE', requested_amount: amount }],
  });
  return submitUse(s.driverCtx, use.id, { version: use.version });
}
for (const inbox of [true, false])
  for (const bulk of [false, true]) {
    test(`${inbox ? '검수함' : '운행 결재'} ${bulk ? '선택' : '바로'} 승인: 표시 후 바뀐 건은 409로 건너뛴다`, async ({
      page,
    }) => {
      const s = await setupScenario(database.db);
      const changed = await submitted(s);
      const unchanged = bulk ? await submitted(s) : null;
      const manager = await s.f.user({ role: 'SITE_MANAGER' });
      await s.f.assignment(manager.id, s.project.id);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await login(page, manager.login_id, inbox ? '/m/review' : '/m/approvals?from=2026-09-01&to=2026-09-30');
      const row = inbox
        ? page.locator('article').filter({ hasText: changed.use_no })
        : page
            .getByLabel('운행 결재 표', { exact: true })
            .locator('tbody tr')
            .filter({ hasText: changed.use_no });
      await expect(row).toContainText('300,000');
      if (bulk) {
        await page
          .getByRole('button', {
            name: inbox ? '문제없는 2건 모두 선택' : '승인 가능 모두 선택',
            exact: true,
          })
          .click();
      }
      await updateUse(s.adminCtx, changed.id, {
        version: changed.version,
        charge_lines: [{ id: changed.charge_lines[0].id, charge_type: 'BASE', requested_amount: 900000 }],
      });
      const response = page.waitForResponse(
        (r) => r.url().endsWith(`/api/uses/${changed.id}/approve`) && r.request().method() === 'POST',
      );
      if (bulk)
        await page
          .getByRole('button', { name: /선택.*승인/ })
          .last()
          .click();
      else await row.getByRole('button', { name: inbox ? '바로 승인' : '승인', exact: true }).click();
      expect((await response).status()).toBe(409);
      await expect(page.getByText(/내용이 바뀌었습니다. 다시 확인한 뒤 승인하세요./)).toBeVisible();
      expect((await getUse(s.adminCtx, changed.id)).review_status).toBe('SUBMITTED');
      if (unchanged) {
        await expect(page.getByText('1건 승인했습니다. 1건 건너뛰었습니다.', { exact: true })).toBeVisible();
        expect((await getUse(s.adminCtx, unchanged.id)).review_status).toBe('APPROVED');
      }
    });
  }
test('기사 정산: 명시적 0원과 미정 금액을 구분한다', async ({ page }) => {
  const s = await setupScenario(database.db);
  await database.db.update(rateAgreements).set({ active: false }).where(eq(rateAgreements.id, s.rate.id));
  const zero = await submitted(s, 0);
  const unknown = await createUse(s.driverCtx, s.input);
  await login(page, s.driverUser.login_id, '/d/settlements?month=2026-09&view=date');
  const zeroRow = page.locator(`a[href="/d/uses/${zero.id}"]`);
  await expect(zeroRow).toContainText('검수 전');
  await expect(zeroRow).toContainText('0원');
  await expect(zeroRow).not.toContainText('금액 미정');
  await expect(page.locator(`a[href="/d/uses/${unknown.id}"]`)).toContainText('금액 미정');
});
test('최근 경로 선택은 같은 현장의 지난 금액을 채운다', async ({ page }) => {
  const s = await setupScenario(database.db);
  await database.db.update(rateAgreements).set({ active: false }).where(eq(rateAgreements.id, s.rate.id));
  const other = await s.f.project();
  await s.f.assignment(s.driverUser.id, other.id);
  await submitted(s, 100000);
  const otherUse = await submitted(s, 900000, other.id);
  await updateUse(s.adminCtx, otherUse.id, { version: otherUse.version, use_date: '2026-09-16' });
  const routesReady = page.waitForResponse((response) => response.url().includes('/api/uses/recent-routes?'));
  await login(page, s.driverUser.login_id, `/d/new?project=${s.project.id}`);
  const routes = (await (await routesReady).json()).data;
  expect(routes[0]).toMatchObject({ project_id: other.id, last_amount: 900000 });
  expect(routes).toEqual(
    expect.arrayContaining([expect.objectContaining({ project_id: s.project.id, last_amount: 100000 })]),
  );
  await page
    .getByRole('group', { name: '1회차 최근 경로', exact: true })
    .getByRole('button', { name: '상차장 → 현장', exact: true })
    .click();
  await expect(page.getByLabel('이번 운행 금액(원)', { exact: true })).toHaveValue('100,000');
});
test('확정 명세의 단가는 계약과 다른 승인 공급가를 반영한다', async ({ page }) => {
  const s = await setupScenario(database.db);
  const use = await submitted(s, 140000);
  const approved = await approveUse(s.adminCtx, use.id, { version: use.version });
  const st = await confirmed(s, [approved.charge_lines[0].id]);
  await login(page, s.admin.login_id, `/m/statements/${st.id}`);
  const row = page.locator('tbody tr').filter({ hasText: use.use_no });
  await expect(row.locator('td').nth(6)).toContainText('140,000원');
  await expect(row.locator('td').nth(7)).toContainText('140,000원');
});
test('운행 결재는 담당자 이름 변경 뒤에도 당시 이름을 표시한다', async ({ page }) => {
  const s = await setupScenario(database.db);
  const use = await submitted(s);
  await approveUse(s.adminCtx, use.id, { version: use.version });
  await database.db.update(users).set({ name: '변경된 담당자' }).where(eq(users.id, s.admin.id));
  await login(
    page,
    s.admin.login_id,
    `/m/approvals?from=2026-09-01&to=2026-09-30&project_id=${s.project.id}&reviewer_user_id=${s.admin.id}`,
  );
  const row = page
    .getByLabel('운행 결재 표', { exact: true })
    .locator('tbody tr')
    .filter({ hasText: use.use_no });
  await expect(row).toContainText(s.admin.name);
  await expect(row).not.toContainText('변경된 담당자');
});
