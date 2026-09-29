import { test, expect } from '@playwright/test';
import { sql } from 'drizzle-orm';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { createDatabase, defaultDatabaseUrl } from '../../src/server/db/client';
import { setupScenario } from '../helpers/factories';
import { createUse, submitUse, getUse } from '../../src/server/services/uses';

import { createEvidence, uploadEvidence } from '../../src/server/services/evidence';

const database = createDatabase(defaultDatabaseUrl());
const evidencePaths: string[] = [];
let scenario: Awaited<ReturnType<typeof setupScenario>>;
let manager: Awaited<ReturnType<Awaited<ReturnType<typeof setupScenario>>['f']['user']>>;
let uses: Awaited<ReturnType<typeof createUse>>[] = [];
test.beforeAll(async () => {
  scenario = await setupScenario(database.db);
  manager = await scenario.f.user({ role: 'SITE_MANAGER', name: 'W3 검수 담당자' });
  await scenario.f.assignment(manager.id, scenario.project.id);
  for (let index = 0; index < 2; index++) {
    let use = await createUse(scenario.adminCtx, {
      ...scenario.input,
      cargo_desc: `W3 브라우저 검수 ${index + 1}`,
      trips: [{ seq: 1, origin: '부산항', destination: '건설 현장' }],
      charge_lines: [
        { charge_type: 'BASE', quantity: '1' },
        { charge_type: 'TOLL', requested_amount: 5000, reason: '고속도로 통행료' },
      ],
    });
    if (index === 0) {
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP0cAAAAASUVORK5CYII=',
        'base64',
      );
      const file = await createEvidence(scenario.adminCtx, use.id, {
        client_upload_id: crypto.randomUUID(),
        kind: 'PHOTO',
        original_name: '현장사진.png',
        mime: 'image/png',
        size: png.length,
      });
      await uploadEvidence(scenario.adminCtx, file.id, png, 'image/png');
      const stored = await database.db.execute(
        sql`SELECT storage_key FROM evidence WHERE id=${file.id}::uuid`,
      );
      evidencePaths.push(
        path.resolve(process.env.STORAGE_DIR ?? 'storage', String(stored.rows[0].storage_key)),
      );
      use = await getUse(scenario.adminCtx, use.id);
    }
    use = await submitUse(scenario.adminCtx, use.id, { version: use.version });
    uses.push(use);
  }
});
test.afterAll(async () => {
  if (scenario) {
    const userIds = [scenario.admin.id, scenario.driverUser.id, ...(manager ? [manager.id] : [])];
    const userList = sql.join(
      userIds.map((id) => sql`${id}::uuid`),
      sql`,`,
    );
    await database.db.transaction(async (db) => {
      await db.execute(sql`DELETE FROM audit_logs WHERE user_id IN (${userList})`);
      await db.execute(sql`DELETE FROM idempotency_keys WHERE user_id IN (${userList})`);
      for (const use of uses) {
        await db.execute(sql`UPDATE vehicle_uses SET approved_revision_id=NULL WHERE id=${use.id}::uuid`);
        await db.execute(sql`DELETE FROM use_revisions WHERE vehicle_use_id=${use.id}::uuid`);
        await db.execute(sql`DELETE FROM charge_lines WHERE vehicle_use_id=${use.id}::uuid`);
        await db.execute(sql`DELETE FROM evidence WHERE vehicle_use_id=${use.id}::uuid`);
        await db.execute(sql`DELETE FROM trips WHERE vehicle_use_id=${use.id}::uuid`);
        await db.execute(sql`DELETE FROM vehicle_uses WHERE id=${use.id}::uuid`);
      }
      await db.execute(sql`DELETE FROM sessions WHERE user_id IN (${userList})`);
      await db.execute(sql`DELETE FROM project_assignments WHERE user_id IN (${userList})`);
      await db.execute(sql`DELETE FROM users WHERE id IN (${userList})`);
      await db.execute(sql`DELETE FROM driver_affiliations WHERE driver_id=${scenario.driver.id}::uuid`);
      await db.execute(sql`DELETE FROM rate_agreements WHERE id=${scenario.rate.id}::uuid`);
      await db.execute(sql`DELETE FROM drivers WHERE id=${scenario.driver.id}::uuid`);
      await db.execute(sql`DELETE FROM vehicles WHERE id=${scenario.vehicle.id}::uuid`);
      await db.execute(sql`DELETE FROM counterparties WHERE id=${scenario.payee.id}::uuid`);
      await db.execute(sql`DELETE FROM projects WHERE id=${scenario.project.id}::uuid`);
    });
  }
  for (const file of evidencePaths) await unlink(file);
  uses = [];
  await database.pool.end();
});
test.beforeEach(async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('아이디', { exact: true }).fill(manager.login_id);
  await page.getByLabel('비밀번호', { exact: true }).fill('password1234');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page).toHaveURL('/m');
});
test('담당자 로그인 → 검수함 → 추가비 한 줄 보류 → 나머지 승인', async ({ page }, testInfo) => {
  await page.getByRole('link', { name: '검수함', exact: true }).click();
  await page.getByRole('link', { name: uses[0].use_no, exact: true }).click();
  await expect(page.getByRole('heading', { name: uses[0].use_no })).toBeVisible();
  await expect(page.getByRole('img', { name: '사진 썸네일' })).toBeVisible();
  await page.getByRole('button', { name: '원본 보기', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('img', { name: '현장사진.png' })).toBeVisible();
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('review-desktop.png'), fullPage: true });
  const toll = page.getByTestId('charge-TOLL');
  await toll.getByLabel('통행료 검수 결정').selectOption('HELD');
  await toll.getByLabel('통행료 검수 사유').fill('영수증 추가 확인');
  await toll.getByRole('button', { name: '적용', exact: true }).click();
  await expect(toll.locator('span').filter({ hasText: /^보류$/ })).toBeVisible();
  await page.getByRole('button', { name: '전체 승인 (보류·반려 제외)', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '검수가 완료되었습니다' })).toBeVisible();
  await expect(
    page
      .getByTestId('charge-BASE')
      .locator('span')
      .filter({ hasText: /^승인$/ }),
  ).toBeVisible();
  await expect(toll.locator('span').filter({ hasText: /^보류$/ })).toBeVisible();
  const response = await page.request.get(`/api/uses/${uses[0].id}`);
  const data = (await response.json()).data;
  expect(data.review_status).toBe('APPROVED');
  expect(
    data.charge_lines.find((line: { charge_type: string }) => line.charge_type === 'TOLL').line_review_status,
  ).toBe('HELD');
  await page.getByRole('tab', { name: '제출·검수 이력' }).click();
  await expect(page.getByRole('heading', { name: '제출 1차' })).toBeVisible();
});
test('보완 항목·메시지 생성과 360px 화면의 사용대장', async ({ page }, testInfo) => {
  await page.getByRole('link', { name: '검수함', exact: true }).click();
  await page.getByRole('link', { name: uses[1].use_no, exact: true }).click();
  await page.getByLabel('보완 항목 1').selectOption('trip:1.destination');
  await page.getByLabel('보완 메시지 1').fill('하차 장소를 정확하게 입력해 주세요.');
  const competing = await page.request.patch(`/api/uses/${uses[1].id}`, {
    data: { version: uses[1].version, notes: '동시 수정 검증' },
  });
  expect(competing.ok()).toBe(true);
  await page.getByRole('button', { name: '보완 요청 보내기' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '다른 사용자가 수정했습니다' })).toBeVisible();
  await page.getByRole('button', { name: '최신 내용 불러오기' }).click();
  await expect(page.getByText('제출 2차 · 버전 3')).toBeVisible();
  await page.getByRole('button', { name: '보완 요청 보내기' }).click();
  await expect(page.getByRole('status').filter({ hasText: '보완 요청을 전달했습니다' })).toBeVisible();
  await page.getByRole('tab', { name: '제출·검수 이력' }).click();
  await expect(page.getByText('trip:1.destination: 하차 장소를 정확하게 입력해 주세요.')).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  await page.getByRole('button', { name: '메뉴', exact: true }).click();
  await page.getByRole('link', { name: '차량 사용대장', exact: true }).click();
  await expect(page.getByRole('heading', { name: '차량 사용대장' })).toBeVisible();
  await expect(page.getByText('전체 검색 결과 합계(2건)', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('ledger-mobile.png'), fullPage: true });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: '검색 결과 전체 엑셀' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('차량사용대장.xlsx');
});
