import { test, expect, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { createDatabase, defaultDatabaseUrl } from '../../src/server/db/client';
import { vehicleUses } from '../../src/server/db/schema';
import { approved, confirmed, draft, scenario } from '../integration/W4-fixtures';
import { createUse, submitUse } from '../../src/server/services/uses';
import { cancelStatement } from '../../src/server/services/statements';
import { recordPayment } from '../../src/server/services/payments';
import { saveFormSettings } from '../../src/server/services/form-settings';
import { audit } from '../../src/server/audit';
let fixture: {
  login: string;
  managerLogin: string;
  userId: string;
  project: string;
  party: string;
  draftNo: string;
  canceledNo: string;
  validNo: string;
  canceledStatement: string;
  statement: string;
  paidStatement: string;
  review: string;
};
test.beforeAll(async () => {
  const { db, pool } = createDatabase(defaultDatabaseUrl());
  try {
    const s = await scenario(db);
    const manager = await s.f.user({ role: 'SETTLEMENT_MANAGER' });
    await s.f.assignment(manager.id, s.project.id);
    const canceled = await approved(s);
    await db.update(vehicleUses).set({ operation_status: 'CANCELED' }).where(eq(vehicleUses.id, canceled.id));
    const pending = await createUse(s.adminCtx, { ...s.input, billing_unit: 'PER_DAY' });
    const valid = await approved(s);
    const first = await approved(s, {
      use_date: '2026-09-14',
      charge_lines: [{ charge_type: 'TOLL', requested_amount: 6600, reason: '통행 영수증' }],
    });
    const second = await approved(s);
    const paid = await confirmed(s, [first.charge_lines[0].id]);
    await recordPayment(s.adminCtx, paid.id, {
      client_request_id: crypto.randomUUID(),
      kind: 'PAYMENT',
      amount: paid.grand_total,
      paid_on: '2026-09-29',
      method: '계좌이체',
    });
    const third = await approved(s, {
      use_date: '2026-09-13',
      charge_lines: [{ charge_type: 'TOLL', requested_amount: 6600, reason: '통행 영수증' }],
    });
    const statement = await draft(s, [second.charge_lines[0].id, third.charge_lines[0].id]);
    const cancelUse = await approved(s);
    const cancel = await confirmed(s, [cancelUse.charge_lines[0].id]);
    await cancelStatement(s.adminCtx, cancel.id, { version: cancel.version, reason: 'F7a 취소 명세' });
    const review = await submitUse(s.adminCtx, pending.id, { version: pending.version });
    const anotherDraft = await createUse(s.adminCtx, { ...s.input, billing_unit: 'PER_DAY' });
    for (const [version, driver_mode] of ['REQUIRED', 'HIDDEN'].entries())
      await saveFormSettings(s.adminCtx, {
        project_id: s.project.id,
        fields: [{ field_key: 'requester', driver_mode, manager_mode: null, version }],
      });
    await audit(s.adminCtx, 'LOGIN', 'session', crypto.randomUUID());
    fixture = {
      login: s.admin.login_id,
      managerLogin: manager.login_id,
      userId: s.admin.id,
      project: s.project.id,
      party: s.payee.id,
      draftNo: anotherDraft.use_no,
      canceledNo: canceled.use_no,
      validNo: valid.use_no,
      canceledStatement: cancel.id,
      statement: statement.id,
      paidStatement: paid.id,
      review: review.id,
    };
  } finally {
    await pool.end();
  }
});
async function login(page: Page, manager = false) {
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    (
      await page.request.post('/api/auth/login', {
        data: { login_id: manager ? fixture.managerLogin : fixture.login, password: 'password1234' },
      })
    ).ok(),
  ).toBe(true);
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('1·2. 후보 기본 숨김·미제출 토글과 취소 명세 집계·지급 표시', async ({ page }) => {
  await login(page, true);
  await page.goto('/m/statements');
  await expect(page.getByText('확정 명세만 합산 · 작성 중·취소 제외', { exact: true })).toBeVisible();
  const canceledRow = page
    .locator('tbody tr')
    .filter({ has: page.locator(`a[href="/m/statements/${fixture.canceledStatement}"]`) });
  await expect(canceledRow).toContainText('—(취소됨)');
  await page.getByRole('button', { name: '새 정산', exact: true }).click();
  await page.getByLabel('거래처', { exact: true }).selectOption(fixture.party);
  await page.getByLabel('기간 시작', { exact: true }).fill('2026-09-01');
  await page.getByLabel('기간 종료', { exact: true }).fill('2026-09-30');
  await page.getByRole('button', { name: '후보 조회', exact: true }).click();
  await expect(page.locator('tbody tr').filter({ hasText: fixture.validNo })).toBeVisible();
  await expect(page.getByText(fixture.canceledNo, { exact: true })).toHaveCount(0);
  await expect(page.getByText(fixture.draftNo, { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '미제출 1건 보기', exact: true }).click();
  const draftRow = page.locator('tbody tr').filter({ hasText: fixture.draftNo });
  await expect(draftRow).toContainText('미제출 사용 건');
  await expect(draftRow.locator('option[value="INCLUDED"]')).toBeDisabled();
  await page.getByRole('button', { name: '미제출 숨기기', exact: true }).click();
  await expect(page.getByText(fixture.draftNo, { exact: true })).toHaveCount(0);
  await fits(page);
});

test('6. 명세 단가·확정 성공·행 순서·조정 대상 비용 종류·취소 뱃지', async ({ page }) => {
  await login(page, true);
  await page.goto(`/m/statements/${fixture.statement}`);
  const toll = page.locator('tbody tr').filter({ hasText: '통행료' });
  await expect(toll).toContainText('단가—');
  const before = await page.locator('tbody tr td:first-child').allTextContents();
  await page.getByRole('button', { name: '명세 확정', exact: true }).click();
  await page.getByRole('button', { name: '확정', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('명세를 확정했습니다.');
  await expect(page.getByText(/^PAY-202609-\d+$/)).toBeVisible();
  await expect(page.locator('tbody tr td:first-child')).toHaveText(before);
  await page.goto(`/m/statements/${fixture.paidStatement}`);
  await expect(page.getByLabel('원명세 항목').locator('option')).toHaveText(/U-2609-\d+ · 통행료 · 6,600원/);
  await page.goto(`/m/statements/${fixture.canceledStatement}`);
  await expect(page.locator('header').getByText('취소', { exact: true })).toHaveClass(/bg-red/);
  await fits(page);
});

test('4·8. 취소 대장 뱃지·핵심 7개 필드·더 보기', async ({ page }) => {
  await login(page, true);
  await page.goto(`/m/ledger?project_id=${fixture.project}`);
  await expect(page.getByRole('button', { name: /필터.*펼치기/ })).toContainText('필터 (1) 펼치기 +');
  await expect(page.getByText(/취소 건은 합계에서 제외/)).toBeVisible();
  const card = page
    .getByLabel('사용대장 카드 목록')
    .locator('article')
    .filter({ hasText: fixture.canceledNo });
  await expect(card.getByText('취소', { exact: true })).toBeVisible();
  await expect(card.locator(':scope > dl > div')).toHaveCount(6);
  await expect(card.getByText('운반 내용', { exact: true })).not.toBeVisible();
  await card.getByText('더 보기', { exact: true }).click();
  await expect(card.getByText('운반 내용', { exact: true })).toBeVisible();
  await fits(page);
});

test('11. 보완요청 대상에 사용일·차량·출발/도착과 운반 내용을 표시한다', async ({ page }) => {
  await login(page, true);
  await page.goto(`/m/uses/${fixture.review}`);
  await page.getByRole('button', { name: '사용 정보·검수' }).click();
  const target = page.getByRole('combobox', { name: '보완 항목 1' });
  await expect(target.locator('option[value="use_date"]')).toHaveText('사용일');
  await expect(target.locator('option[value="vehicle_id"]')).toHaveText('차량');
  await expect(target.locator('option[value="trip:1.origin"]')).toHaveText('1회 출발(상차지)');
  await expect(target.locator('option[value="trip:1.destination"]')).toHaveText('1회 도착(하차지)');
  await expect(target.locator('option[value="cargo_desc"]')).toHaveText('운반 내용');
  await target.selectOption('trip:1.origin');
  await page.getByLabel('보완 메시지 1').fill('출발을 확인해 주세요');
  await page.getByRole('button', { name: '보완 요청 보내기' }).click();
  await expect(page.getByRole('status').filter({ hasText: '보완 요청을 전달했습니다.' })).toBeVisible();
});

test('9. 설정 그룹 접기·현장 URL 유지', async ({ page }) => {
  await login(page);
  await page.goto(`/m/master/form-fields?project=${fixture.project}`);
  await expect(page.getByLabel('설정할 현장')).toHaveValue(fixture.project);
  const group = page.getByRole('button', { name: /사용 정보.*펼치기/ });
  await expect(group).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: '요청자 · 기사', exact: true })).not.toBeVisible();
  await group.click();
  await expect(
    page.getByRole('radiogroup', { name: '요청자 · 기사', exact: true }).getByRole('radio', { name: '숨김' }),
  ).toBeChecked();
  await page.getByLabel('설정할 현장').selectOption('');
  await expect(page).not.toHaveURL(/project=/);
  await page.getByLabel('설정할 현장').selectOption(fixture.project);
  await expect(page).toHaveURL(new RegExp(`project=${fixture.project}`));
  await page.reload();
  await expect(page.getByLabel('설정할 현장')).toHaveValue(fixture.project);
  await fits(page);
});

test('5. 잘못된 대리 입력 URL 파라미터를 API 요청 전에 제거한다', async ({ page }) => {
  await login(page);
  const badRequests: string[] = [];
  page.on('request', (r) => {
    if (/api\/(form-settings|rates\/lookup)/.test(r.url()) && r.url().includes('__none'))
      badRequests.push(r.url());
  });
  await page.goto('/m/uses/new?project=__none');
  await expect(page).not.toHaveURL(/__none/);
  await expect(page.getByLabel('현장', { exact: true })).not.toHaveValue('__none');
  expect(badRequests).toEqual([]);
});

test('3·10. 변경 이력 모바일 필터와 세션 토글·항목/현장·제출본 번호', async ({ page }) => {
  await login(page);
  await page.goto('/m/audit');
  await expect(page.getByLabel('대상 유형')).not.toBeVisible();
  await page.getByRole('button', { name: '필터 펼치기 +', exact: true }).click();
  await page.getByRole('combobox', { name: /^사용자/ }).selectOption(fixture.userId);
  await page.getByLabel('대상 유형').selectOption('session');
  await page.getByRole('button', { name: '이력 조회' }).click();
  await expect(page.getByText('변경 이력이 없습니다.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '필터 펼치기 +', exact: true }).click();
  await page.getByLabel('로그인·로그아웃 포함').check();
  await page.getByRole('button', { name: '이력 조회' }).click();
  await expect(page.locator('article').filter({ hasText: '로그인' }).first()).toBeVisible();
  await page.getByRole('button', { name: '필터 펼치기 +', exact: true }).click();
  await page.getByLabel('대상 유형').selectOption('form_field_setting');
  await page.getByRole('button', { name: '이력 조회' }).click();
  await expect(page.getByText('요청자(테스트 현장)', { exact: true }).first()).toBeVisible();
  await fits(page);
});
