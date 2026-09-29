import { expect, test, type Locator, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../../src/server/db/client';
import { vehicleUses } from '../../src/server/db/schema';
import { setupScenario } from '../helpers/factories';
import { saveFormSettings } from '../../src/server/services/form-settings';
import { createUse, getUse } from '../../src/server/services/uses';
import { fieldKeys } from '../../src/shared/form-settings';

const database = createDatabase(process.env.DATABASE_URL!);
test.use({ viewport: { width: 390, height: 844 }, actionTimeout: 15000 });
test.setTimeout(120000);
test.afterAll(async () => database.pool.end());

async function login(page: Page, loginId: string, path: string) {
  await page.request.post('/api/auth/login', { data: { login_id: loginId, password: 'password1234' } });
  await page.goto(path);
  await expect(page.getByRole('button', { name: '서버 저장', exact: true })).toBeEnabled();
}

async function clearAndRetype(input: Locator, value: string) {
  await input.fill('');
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  await input.fill(value);
}

for (const mode of ['driver', 'manager'] as const) {
  test(`390px ${mode} 숨김 헤더를 전부 지워도 입력란·포커스를 유지하고 새 값을 저장한다`, async ({
    page,
  }) => {
    const s = await setupScenario(database.db);
    const workType = await s.f.workType();
    await saveFormSettings(s.adminCtx, {
      project_id: s.project.id,
      fields: fieldKeys.map((field_key) => ({
        field_key,
        driver_mode: 'HIDDEN',
        manager_mode: 'HIDDEN',
        version: 0,
      })),
    });
    const use = await createUse(s.driverCtx, {
      ...s.input,
      requester: '기존 요청자',
      cargo_desc: '기존 화물',
      notes: '기존 특이사항',
      end_date: s.input.use_date,
      work_type_id: workType.id,
    });
    await login(
      page,
      mode === 'driver' ? s.driverUser.login_id : s.admin.login_id,
      mode === 'driver' ? `/d/uses/${use.id}` : `/m/uses/${use.id}/edit`,
    );
    for (const [label, value] of [
      ['요청자', '새 요청자'],
      ['운반 내용', '새 화물'],
      ['특이사항', '새 특이사항'],
      ['종료일 (선택)', s.input.use_date],
    ])
      await clearAndRetype(page.getByLabel(label, { exact: true }), value);
    const work = page.getByLabel('공종 (선택)', { exact: true });
    await work.focus();
    await work.selectOption('');
    await expect(work).toBeVisible();
    await expect(work).toBeFocused();
    await work.selectOption(workType.id);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.getByRole('button', { name: '서버 저장', exact: true }).click();
    await expect.poll(async () => (await getUse(s.driverCtx, use.id)).notes).toBe('새 특이사항');
    expect(await getUse(s.driverCtx, use.id)).toMatchObject({
      requester: '새 요청자',
      cargo_desc: '새 화물',
      notes: '새 특이사항',
      end_date: s.input.use_date,
      work_type_id: workType.id,
    });
    if (mode === 'manager') await expect(page).toHaveURL(`/m/uses/${use.id}`);
    else await expect(page.getByRole('status')).toHaveText('서버 저장(작성중)');
  });
}

test('390px 숨김 회차 입력과 추가비의 값을 지워도 포커스를 유지하고 저장한다', async ({ page }) => {
  const s = await setupScenario(database.db);
  await saveFormSettings(s.adminCtx, {
    project_id: s.project.id,
    fields: fieldKeys.map((field_key) => ({
      field_key,
      driver_mode: 'HIDDEN',
      manager_mode: 'HIDDEN',
      version: 0,
    })),
  });
  const use = await createUse(s.driverCtx, {
    ...s.input,
    trips: [
      {
        seq: 1,
        origin: '창고',
        destination: '현장',
        cargo_desc: '골재',
        via: ['경유지'],
        quantity: '0',
        quantity_unit: '톤',
        hours: '0',
        depart_at: '2026-09-01T00:00:00.000Z',
        arrive_at: '2026-09-01T01:00:00.000Z',
        notes: '기존 비고',
      },
    ],
    charge_lines: [
      { charge_type: 'BASE' },
      { charge_type: 'TOLL', requested_amount: 1200, reason: '통행료' },
    ],
  });
  await login(page, s.driverUser.login_id, `/d/uses/${use.id}`);
  for (const [label, value] of [
    ['1회차 화물', '모래'],
    ['1회차 경유 (쉼표 구분)', '새 경유지'],
    ['1회차 수량', '2.5'],
    ['1회차 수량 단위', '루베'],
    ['1회차 시간', '1.5'],
    ['1회차 출발시각 (서울)', '2026-09-01T10:00'],
    ['1회차 도착시각 (서울)', '2026-09-01T11:00'],
    ['1회차 비고', '새 비고'],
  ])
    await clearAndRetype(page.getByLabel(label, { exact: true }), value);
  const amount = page.getByLabel(/^추가비 \d+ 요청액 \(원\)$/);
  const reason = page.getByLabel(/^추가비 \d+ 사유$/);
  await amount.fill('');
  await expect(amount).toBeFocused();
  await reason.fill('');
  await expect(reason).toBeFocused();
  await expect(amount).toBeVisible();
  await amount.fill('2400');
  await reason.fill('새 통행료');
  await page.getByRole('button', { name: '서버 저장', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('서버 저장(작성중)');
  const saved = await getUse(s.driverCtx, use.id);
  expect(saved.trips[0]).toMatchObject({
    cargo_desc: '모래',
    via: ['새 경유지'],
    quantity: '2.500',
    quantity_unit: '루베',
    hours: '1.500',
    notes: '새 비고',
  });
  expect(new Date(saved.trips[0].depart_at!).toISOString()).toBe('2026-09-01T01:00:00.000Z');
  expect(new Date(saved.trips[0].arrive_at!).toISOString()).toBe('2026-09-01T02:00:00.000Z');
  expect(saved.charge_lines.find((line) => line.charge_type === 'TOLL')).toMatchObject({
    requested_amount: 2400,
    reason: '새 통행료',
  });
});

test('마지막 상세값 삭제·회차 이동·삭제 후 빈 숨김 입력을 오프라인 초안에서 복구한다', async ({
  page,
  context,
}) => {
  const s = await setupScenario(database.db);
  const recent = await createUse(s.driverCtx, {
    ...s.input,
    trips: [{ seq: 1, origin: '복구 창고', destination: '복구 현장', via: ['기존 경유지'] }],
  });
  await login(page, s.driverUser.login_id, `/d/new?project=${s.project.id}`);
  await page.getByLabel('1회차 최근 경로', { exact: true }).selectOption('0');
  const via = page.getByLabel('1회차 경유 (쉼표 구분)', { exact: true });
  await expect(via).toHaveValue('기존 경유지');
  await via.fill('');
  await expect(via).toBeVisible();
  await expect(via).toBeFocused();
  await expect(page.getByLabel('1회차 공차회차', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '+ 운행 추가', exact: true }).click();
  await expect(page.getByLabel('2회차 경유 (쉼표 구분)', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '2회차 위로', exact: true }).click();
  await page.getByRole('button', { name: '2회차 펼치기', exact: true }).click();
  await expect(page.getByLabel('2회차 경유 (쉼표 구분)', { exact: true })).toBeVisible();
  await expect(page.getByLabel('1회차 경유 (쉼표 구분)', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '1회차 삭제', exact: true }).click();
  await expect(via).toBeVisible();
  await expect(via).toHaveValue('');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.getByRole('status')).toHaveText('휴대폰에 임시저장됨');
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(via).toBeVisible();
  await expect(via).toHaveValue('');
  await expect(page.getByLabel('1회차 비고', { exact: true })).toHaveCount(0);
  await clearAndRetype(via, '복구 후 경유지');
  await context.setOffline(false);
  await page.getByRole('button', { name: '서버 저장', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('서버 저장(작성중)');
  const rows = await database.db.select().from(vehicleUses).where(eq(vehicleUses.driver_id, s.driver.id));
  const created = rows.find((row) => row.id !== recent.id)!;
  expect((await getUse(s.driverCtx, created.id)).trips[0].via).toEqual(['복구 후 경유지']);
});

test('한 번 노출된 빈 항목과 기본 상태·공차를 숨김으로 바꿔도 기기 초안에서 유지한다', async ({
  page,
  context,
}) => {
  const s = await setupScenario(database.db);
  const keys = ['requester', 'notes', 'trip_status', 'is_empty_return'] as const;
  await saveFormSettings(s.adminCtx, {
    project_id: s.project.id,
    fields: keys.map((field_key) => ({ field_key, driver_mode: 'OPTIONAL', manager_mode: null, version: 0 })),
  });
  await login(page, s.driverUser.login_id, `/d/new?project=${s.project.id}`);
  await page.getByLabel('1회차 출발', { exact: true }).fill('창고');
  await page.getByLabel('1회차 도착', { exact: true }).fill('현장');
  await expect(page.getByLabel('요청자', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('특이사항', { exact: true })).toHaveValue('');
  await page.getByText('1회차 상세 입력', { exact: true }).click();
  const emptyReturn = page.getByLabel('1회차 공차회차', { exact: true });
  await emptyReturn.check();
  await saveFormSettings(s.adminCtx, {
    project_id: s.project.id,
    fields: keys.map((field_key) => ({ field_key, driver_mode: 'HIDDEN', manager_mode: null, version: 1 })),
  });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('[data-fix-target="requester"]')).toContainText('관리자 설정상 숨김 항목입니다');
  await emptyReturn.uncheck();
  await expect(emptyReturn).toBeVisible();
  await expect(emptyReturn).toBeFocused();
  const status = page.getByLabel('1회차 운행 상태', { exact: true });
  await status.selectOption('IN_PROGRESS');
  await status.focus();
  await status.selectOption('COMPLETED');
  await expect(status).toBeVisible();
  await expect(status).toBeFocused();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.getByRole('status')).toHaveText('휴대폰에 임시저장됨');
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('요청자', { exact: true })).toBeVisible();
  await expect(page.getByLabel('특이사항', { exact: true })).toBeVisible();
  await expect(emptyReturn).toBeVisible();
  await expect(emptyReturn).not.toBeChecked();
  await expect(status).toHaveValue('COMPLETED');
  await clearAndRetype(page.getByLabel('요청자', { exact: true }), '복구 요청자');
  await clearAndRetype(page.getByLabel('특이사항', { exact: true }), '복구 특이사항');
  await context.setOffline(false);
  await page.getByRole('button', { name: '서버 저장', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('서버 저장(작성중)');
  const [row] = await database.db.select().from(vehicleUses).where(eq(vehicleUses.driver_id, s.driver.id));
  const saved = await getUse(s.driverCtx, row.id);
  expect(saved).toMatchObject({ requester: '복구 요청자', notes: '복구 특이사항' });
  expect(saved.trips[0]).toMatchObject({ status: 'COMPLETED', is_empty_return: false });
});
