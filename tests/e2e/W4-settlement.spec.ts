import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createDatabase, defaultDatabaseUrl } from '../../src/server/db/client';
import { approved, scenario } from '../integration/W4-fixtures';
import { confirmStatement } from '../../src/server/services/statements';
import { draft } from '../integration/W4-fixtures';
let fixture: { login: string; driverLogin: string; partyId: string; statementId: string; otherUseNo: string };
test.beforeAll(async () => {
  const { db, pool } = createDatabase(defaultDatabaseUrl());
  try {
    const s = await scenario(db);
    const user = await s.f.user({
      role: 'SETTLEMENT_MANAGER',
      name: 'W4 정산 담당자',
      login_id: `w4-e2e-${randomUUID().slice(0, 8)}`,
    });
    await s.f.assignment(user.id, s.project.id);
    await approved(s, {
      cargo_desc: 'W4 브라우저 운반',
      trips: [{ seq: 1, origin: '공장', destination: '현장' }],
    });
    const other = await s.f.driver({ name: '숨겨질 기사' });
    await s.f.affiliation(other.id, s.payee.id);
    const otherUse = await approved(s, { driver_id: other.id });
    const otherDraft = await draft(
      s,
      otherUse.charge_lines.map((l) => l.id),
    );
    const otherStatement = await confirmStatement(s.adminCtx, otherDraft.id, {
      confirmation_token: otherDraft.confirmation_token!,
      version: 1,
    });
    fixture = {
      login: user.login_id,
      driverLogin: s.driverUser.login_id,
      partyId: s.payee.id,
      statementId: otherStatement.id,
      otherUseNo: otherUse.use_no,
    };
  } finally {
    await pool.end();
  }
});
test('정산 담당자: 새 정산 → 확정 → PDF·엑셀 200 → 지급 완료', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('아이디', { exact: true }).fill(fixture.login);
  await page.getByLabel('비밀번호', { exact: true }).fill('password1234');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForURL('/m');
  await page.getByRole('link', { name: '월 정산', exact: true }).click();
  await page.getByRole('button', { name: '새 정산', exact: true }).click();
  await page.getByLabel('거래처', { exact: true }).selectOption(fixture.partyId);
  await page.getByLabel('기간 시작', { exact: true }).fill('2026-09-01');
  await page.getByLabel('기간 종료', { exact: true }).fill('2026-09-30');
  await page.getByLabel('지급 예정일', { exact: true }).fill('2026-10-10');
  await page.getByRole('button', { name: '후보 조회' }).click();
  await expect(page.getByText('포함 가능', { exact: true })).toBeVisible();
  const inclusion = page.getByLabel(/ 포함 여부$/).first();
  await inclusion.selectOption('HELD');
  await page.getByRole('button', { name: '초안 만들기' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '보류 사유를 입력해 주세요.' })).toBeVisible();
  await expect(page.getByLabel(/ 보류 사유$/).first()).toBeFocused();
  await inclusion.selectOption('INCLUDED');
  await page.getByRole('button', { name: '초안 만들기' }).click();
  await page.waitForURL(/\/m\/statements\/[0-9a-f-]+$/);
  await expect(page.getByText('확정 시 부여', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '명세 확정', exact: true }).click();
  await page.getByRole('button', { name: '확정', exact: true }).click();
  await expect(page.getByText(/^PAY-202609-\d+$/)).toBeVisible();
  await expect(page.getByText(/예정일: 2026-10-10/)).toBeVisible();
  for (const [label, extension] of [
    ['PDF 다운로드', 'pdf'],
    ['엑셀 다운로드', 'xlsx'],
  ]) {
    const link = page.getByRole('link', { name: label });
    const response = await page.request.get((await link.getAttribute('href'))!);
    expect(response.status()).toBe(200);
    const download = page.waitForEvent('download');
    await link.click();
    expect((await download).suggestedFilename()).toMatch(new RegExp(`\\.${extension}$`));
  }
  await page.getByLabel('지급일', { exact: true }).fill('2026-09-29');
  await page.getByLabel('참고번호', { exact: true }).fill('E2E-PAY-1');
  await page.getByLabel('메모', { exact: true }).fill('브라우저 전액 지급 검증');
  await page.getByRole('button', { name: '지급 기록 저장' }).click();
  await expect(page.getByText('지급 완료', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '명세 취소', exact: true })).toBeDisabled();
  await page.getByRole('link', { name: '지급 관리', exact: true }).click();
  await page.getByLabel('조회 상태').selectOption('PAID');
  await expect(page.getByText('지급 완료', { exact: true }).last()).toBeVisible();
});
test('360px 기사 내 정산: 본인분 요약과 다른 기사 export 차단', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/login');
  await page.getByLabel('아이디', { exact: true }).fill(fixture.driverLogin);
  await page.getByLabel('비밀번호', { exact: true }).fill('password1234');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForURL('/d');
  await page.getByRole('link', { name: '내 정산', exact: true }).click();
  await page.goto('/d/settlements?month=2026-09');
  await expect(page.getByRole('heading', { name: '9월 운행', exact: true })).toBeVisible();
  await expect(page.getByText(fixture.otherUseNo, { exact: false })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const response = await page.request.get(`/api/statements/${fixture.statementId}/export.pdf`);
  expect(response.status()).toBe(404);
});
