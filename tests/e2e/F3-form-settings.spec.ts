import { expect, test, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../../src/server/db/client';
import { vehicleUses } from '../../src/server/db/schema';
import { setupScenario } from '../helpers/factories';
import { saveFormSettings } from '../../src/server/services/form-settings';
import { createUse, getUse, requestFix, submitUse } from '../../src/server/services/uses';

const database = createDatabase(process.env.DATABASE_URL!);
test.use({ viewport: { width: 390, height: 844 }, actionTimeout: 15000 });
test.setTimeout(120000);
test.afterAll(async () => database.pool.end());
async function login(page: Page, login_id: string, path = '/d/new') {
  await page.request.post('/api/auth/login', { data: { login_id, password: 'password1234' } });
  await page.goto(path);
}

test('담당자 보완 항목은 기사에게 숨긴 요청자·추가비를 선택할 수 없다', async ({ page }) => {
  const s = await setupScenario(database.db);
  const manager = await s.f.user({ role: 'SITE_MANAGER' });
  await s.f.assignment(manager.id, s.project.id);
  await saveFormSettings(s.adminCtx, {
    project_id: s.project.id,
    fields: [{ field_key: 'extra_charges', driver_mode: 'HIDDEN', manager_mode: 'OPTIONAL', version: 0 }],
  });
  let use = await createUse(s.driverCtx, {
    ...s.input,
    requester: '기존 요청자',
    charge_lines: [
      { charge_type: 'BASE' },
      { charge_type: 'TOLL', requested_amount: 1200, reason: '통행료' },
    ],
  });
  use = await submitUse(s.driverCtx, use.id, { version: use.version });
  await login(page, manager.login_id, `/m/uses/${use.id}`);
  const select = page.getByLabel(/^보완 항목 1/);
  await expect(page.getByRole('button', { name: '보완 요청 보내기', exact: true })).toBeEnabled();
  await expect(select.locator('option[value="requester"]')).toHaveJSProperty('disabled', true);
  const toll = use.charge_lines.find((line) => line.charge_type === 'TOLL')!;
  await expect(select.locator(`option[value="charge:${toll.id}"]`)).toHaveJSProperty('disabled', true);
  await select.selectOption('cargo_desc');
  await page.getByLabel('보완 메시지 1', { exact: true }).fill('운반 내용을 보완하세요');
  await page.getByRole('button', { name: '보완 요청 보내기', exact: true }).click();
  await expect(page.getByText('보완 요청을 전달했습니다.', { exact: true })).toBeVisible();
  expect((await getUse(s.driverCtx, use.id)).review_status).toBe('NEEDS_FIX');
});

async function pendingFix() {
  const s = await setupScenario(database.db);
  await saveFormSettings(s.adminCtx, {
    project_id: s.project.id,
    fields: [
      { field_key: 'requester', driver_mode: 'OPTIONAL', manager_mode: null, version: 0 },
      { field_key: 'via', driver_mode: 'OPTIONAL', manager_mode: null, version: 0 },
      { field_key: 'notes', driver_mode: 'OPTIONAL', manager_mode: null, version: 0 },
    ],
  });
  let use = await createUse(s.driverCtx, s.input);
  use = await submitUse(s.driverCtx, use.id, { version: use.version });
  use = await requestFix(s.adminCtx, use.id, {
    version: use.version,
    fix_items: [
      { target: 'use.requester', message: '요청자 보완' },
      { target: 'trip:1.via', message: '경유 보완' },
      { target: 'notes', message: '특이사항 보완' },
    ],
  });
  return { ...s, use };
}

test('숨김 변경 경고를 확인하고 저장해도 기존 보완요청을 보존한다', async ({ page }) => {
  const s = await pendingFix();
  await login(page, s.admin.login_id, '/m/master/form-fields');
  await page.getByRole('button', { name: /사용 정보.*펼치기/ }).click();
  await page.getByLabel('설정할 현장', { exact: true }).selectOption(s.project.id);
  await expect(
    page.getByRole('radiogroup', { name: '요청자 · 기사', exact: true }).getByRole('radio', { name: '선택' }),
  ).toBeChecked();
  await page
    .getByRole('radiogroup', { name: '요청자 · 기사', exact: true })
    .getByRole('radio', { name: '숨김' })
    .check();
  await expect(
    page.getByRole('region', { name: '요청자 설정', exact: true }).getByRole('alert'),
  ).toContainText('미해결 보완요청이 1건 있습니다');
  await page.getByRole('button', { name: '설정 저장', exact: true }).click();
  await expect(page.getByText('입력 항목 설정을 저장했습니다. 변경 이력에 기록되었습니다.')).toBeVisible();
  expect((await getUse(s.driverCtx, s.use.id)).revisions[0].fix_items).toEqual(s.use.revisions[0].fix_items);
});

test('기존 보완요청 대상은 빈 숨김 항목도 표시·이동·수정하고 재제출한다', async ({ page }) => {
  const s = await pendingFix();
  await saveFormSettings(s.adminCtx, {
    project_id: s.project.id,
    fields: [
      { field_key: 'requester', driver_mode: 'HIDDEN', manager_mode: null, version: 1 },
      { field_key: 'via', driver_mode: 'HIDDEN', manager_mode: null, version: 1 },
      { field_key: 'notes', driver_mode: 'HIDDEN', manager_mode: null, version: 1 },
    ],
  });
  await login(page, s.driverUser.login_id, `/d/uses/${s.use.id}`);
  const requester = page.getByLabel('요청자', { exact: true });
  await expect(requester).toBeEnabled();
  await page.getByRole('button', { name: '요청자 보완 →', exact: true }).click();
  await expect(requester).toBeFocused();
  await requester.fill('담당자');
  await expect(page.getByLabel('1회차 경유 (쉼표 구분)', { exact: true })).toBeVisible();
  await page.getByLabel('1회차 경유 (쉼표 구분)', { exact: true }).fill('중간 창고');
  await page.getByLabel('특이사항', { exact: true }).fill('보완 완료');
  await page.getByRole('button', { name: '보완 후 재제출', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('담당자에게 제출 완료');
  const use = await getUse(s.driverCtx, s.use.id);
  expect(use).toMatchObject({ requester: '담당자', notes: '보완 완료', review_status: 'SUBMITTED' });
  expect(use.trips[0].via).toEqual(['중간 창고']);
});

for (const action of ['수정', '삭제'] as const) {
  test(`열린 기사 폼의 미완성 추가비를 숨겨도 ${action} 후 저장·제출할 수 있다`, async ({ page }) => {
    const s = await setupScenario(database.db);
    await login(page, s.driverUser.login_id);
    await page.getByLabel('1회차 출발', { exact: true }).fill('창고');
    await page.getByLabel('1회차 도착', { exact: true }).fill('현장');
    await page.getByRole('button', { name: '+ 추가 비용', exact: true }).click();
    await page.getByLabel('추가비 1 요청액 (원)', { exact: true }).fill('1200');
    await saveFormSettings(s.adminCtx, {
      project_id: s.project.id,
      fields: [{ field_key: 'extra_charges', driver_mode: 'HIDDEN', manager_mode: 'HIDDEN', version: 0 }],
    });
    await page.getByRole('button', { name: '담당자에게 제출', exact: true }).click();
    await expect(page.locator('#form-errors')).toContainText(
      '추가 비용은 정수 원 요청액과 사유를 입력하세요.',
    );
    await expect(page.getByLabel('추가비 1 요청액 (원)', { exact: true })).toHaveValue('1200');
    await expect(page.getByText('관리자 설정상 숨김 항목입니다', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '+ 추가 비용', exact: true })).toHaveCount(0);
    if (action === '수정') {
      await page.getByLabel('추가비 1 사유', { exact: true }).fill('통행료');
    } else {
      await page.getByRole('button', { name: '추가 비용 삭제', exact: true }).click();
    }
    await page.getByRole('button', { name: '서버 저장', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('서버 저장(작성중)');
    await page.getByRole('button', { name: '담당자에게 제출', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('담당자에게 제출 완료');
    const [row] = await database.db.select().from(vehicleUses).where(eq(vehicleUses.driver_id, s.driver.id));
    const use = await getUse(s.driverCtx, row.id);
    expect(use.charge_lines.filter((line) => line.charge_type === 'TOLL')).toHaveLength(
      action === '수정' ? 1 : 0,
    );
    if (action === '수정')
      expect(use.charge_lines.find((line) => line.charge_type === 'TOLL')).toMatchObject({
        requested_amount: 1200,
        reason: '통행료',
      });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  });
}
