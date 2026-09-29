import { expect, test, type Locator, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../../src/server/db/client';
import { vehicleUses } from '../../src/server/db/schema';
import { setupScenario } from '../helpers/factories';
import { saveFormSettings } from '../../src/server/services/form-settings';
import { cancelUse, createUse, getUse, requestFix, submitUse } from '../../src/server/services/uses';
import { fieldKeys } from '../../src/shared/form-settings';

const database = createDatabase(process.env.DATABASE_URL!);
test.use({ viewport: { width: 390, height: 844 }, actionTimeout: 15000 });
test.afterAll(async () => database.pool.end());

async function login(page: Page, loginId: string, path: string) {
  await page.request.post('/api/auth/login', { data: { login_id: loginId, password: 'password1234' } });
  await page.goto(path);
  await expect(page.getByRole('button', { name: '서버 저장', exact: true })).toBeEnabled();
}

async function drafts(page: Page) {
  return page.evaluate(async () => {
    const user = localStorage.getItem('vehicle-active-user');
    return new Promise<{ id: string; form: { project_id: string } }[]>((resolve, reject) => {
      const request = indexedDB.open(`vehicle-w2-${user}`, 1);
      request.onsuccess = () => {
        const db = request.result;
        const rows = db.transaction('drafts').objectStore('drafts').getAll();
        rows.onsuccess = () => {
          db.close();
          resolve(rows.result);
        };
        rows.onerror = () => reject(rows.error);
      };
      request.onerror = () => reject(request.error);
    });
  });
}

async function fillRoute(page: Page) {
  await page.getByLabel('1회차 출발', { exact: true }).fill('창고');
  await page.getByLabel('1회차 도착', { exact: true }).fill('현장');
}

async function expectInputError(input: Locator, message: string) {
  await expect(input).toBeFocused();
  await expect(input).toBeInViewport();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(input).toHaveCSS('border-top-color', 'rgb(185, 28, 28)');
  await expect(input.locator('..')).toContainText(message);
}

test('빈 신규 화면은 자동 단가가 적용되어도 기기 초안으로 저장·집계하지 않는다', async ({ page }) => {
  const s = await setupScenario(database.db);
  await login(page, s.driverUser.login_id, `/d/new?project=${s.project.id}`);
  await expect(page.getByLabel('과금 단위', { exact: true })).toHaveValue('PER_DAY');
  await page.getByLabel('1회차 출발', { exact: true }).fill('   ');
  // Includes debounced, periodic and pagehide/flush persistence paths.
  await page.waitForTimeout(3300);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  expect(await drafts(page)).toHaveLength(0);
  await page.goto('/d');
  await expect(page.getByText('기기 미전송', { exact: true }).locator('..')).toContainText('0건');
});

test('새 폼은 project를 반영하고 미전송 초안은 배너에서 명시적으로 선택한다', async ({ page }) => {
  const s = await setupScenario(database.db);
  const second = await s.f.project({ name: '두 번째 현장' });
  await s.f.assignment(s.driverUser.id, second.id);
  await login(page, s.driverUser.login_id, `/d/new?project=${s.project.id}`);
  await fillRoute(page);
  await expect.poll(async () => (await drafts(page)).length).toBe(1);
  const [stored] = await drafts(page);
  await page.goto(`/d/new?project=${second.id}`);
  await expect(page.locator(`input[name=\"project_id\"][value=\"${second.id}\"]`)).toBeChecked();
  await expect(page.getByLabel('1회차 출발', { exact: true })).toHaveValue('');
  await page.getByText('작성 중이던 운행 1건 이어서 쓰기', { exact: true }).click();
  await page.locator(`a[href="/d/new?draft=${stored.id}"]`).click();
  await expect(page.locator(`input[name=\"project_id\"][value=\"${s.project.id}\"]`)).toBeChecked();
  await expect(page.getByLabel('1회차 출발', { exact: true })).toHaveValue('창고');
  expect(await drafts(page)).toHaveLength(1);
});

test('접근 불가능하거나 잘못된 project 쿼리는 신규 기본 현장으로 대체한다', async ({ page }) => {
  const s = await setupScenario(database.db);
  await login(page, s.driverUser.login_id, '/d/new?project=invalid-project');
  await expect(page.locator(`input[name=\"project_id\"][value=\"${s.project.id}\"]`)).toBeChecked();
  const inaccessible = await s.f.project();
  await page.goto(`/d/new?project=${inaccessible.id}`);
  await expect(page.locator(`input[name=\"project_id\"][value=\"${s.project.id}\"]`)).toBeChecked();
});

for (const state of ['saved', 'fix', 'copy'] as const) {
  test(`저장 기본값은 숨김 필드를 노출하지 않는다: ${state}`, async ({ page }) => {
    const s = await setupScenario(database.db);
    await saveFormSettings(s.adminCtx, {
      project_id: s.project.id,
      fields: fieldKeys.map((field_key) => ({
        field_key,
        driver_mode: 'HIDDEN',
        manager_mode: null,
        version: 0,
      })),
    });
    let use = await createUse(s.driverCtx, s.input);
    if (state === 'fix') {
      use = await submitUse(s.driverCtx, use.id, { version: use.version });
      use = await requestFix(s.adminCtx, use.id, {
        version: use.version,
        comment: '도착 확인',
        fix_items: [{ target: 'trip:1.destination', message: '도착을 수정하세요' }],
      });
    }
    await login(page, s.driverUser.login_id, `/d/uses/${use.id}`);
    if (state === 'copy') {
      await page.getByRole('button', { name: '이전 운행 복사', exact: true }).click();
      await expect(page).toHaveURL(/\/d\/new\?draft=/);
      await expect(page.getByRole('button', { name: '서버 저장', exact: true })).toBeEnabled();
    }
    await expect(page.getByLabel('전체 운행 상태', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('1회차 운행 상태', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('1회차 공차회차', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('1회차 화물', { exact: true })).toHaveCount(0);
    await expect(page.getByText('관리자 설정상 숨김 항목입니다', { exact: true })).toHaveCount(0);
  });
}

test('제출 성공은 상세로 이동해 최상단에 결과를 표시한다', async ({ page }) => {
  const s = await setupScenario(database.db);
  await login(page, s.driverUser.login_id, `/d/new?project=${s.project.id}`);
  await fillRoute(page);
  await page.getByRole('button', { name: '담당자에게 제출', exact: true }).click();
  await expect(page).toHaveURL(/\/d\/uses\/[\w-]+/);
  await expect(page.getByText('담당자에게 제출했습니다', { exact: true })).toBeInViewport();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const [row] = await database.db.select().from(vehicleUses).where(eq(vehicleUses.driver_id, s.driver.id));
  expect((await getUse(s.driverCtx, row.id)).review_status).toBe('SUBMITTED');
});

test('청구수량 누락은 수량 입력으로 이동하고 인라인 오류·빨간 테두리를 표시한다', async ({ page }) => {
  const s = await setupScenario(database.db);
  await login(page, s.driverUser.login_id, `/d/new?project=${s.project.id}`);
  await fillRoute(page);
  await page.getByLabel('과금 단위', { exact: true }).selectOption('PER_HOUR');
  const quantity = page.getByLabel('청구수량', { exact: true });
  await quantity.fill('');
  await page.getByRole('button', { name: '담당자에게 제출', exact: true }).click();
  await expectInputError(quantity, '청구 수량을 입력하세요');
  await expect(page.locator('#form-errors')).toContainText('청구 수량을 입력하세요');
});

test('설정 필수·회차·증빙 오류를 모두 요약하고 화면의 첫 오류부터 이동한다', async ({ page }) => {
  const s = await setupScenario(database.db, { evidence_policy: 'PHOTO_REQUIRED' });
  await saveFormSettings(s.adminCtx, {
    project_id: s.project.id,
    fields: ['requester', 'via'].map((field_key) => ({
      field_key: field_key as 'requester' | 'via',
      driver_mode: 'REQUIRED',
      manager_mode: null,
      version: 0,
    })),
  });
  await login(page, s.driverUser.login_id, `/d/new?project=${s.project.id}`);
  await fillRoute(page);
  await page.getByRole('button', { name: '1회차 입력 완료', exact: true }).click();
  await page.getByRole('button', { name: '담당자에게 제출', exact: true }).click();
  await expectInputError(page.getByLabel('요청자'), '요청자 항목을 입력하세요.');
  await expect(page.locator('#form-errors')).toContainText('1회차 경유 항목을 입력하세요.');
  await expect(page.locator('#form-errors')).toContainText('사진·인수증·계근표·확인서 중 1개 이상');
  await page.getByLabel('요청자').fill('현장 담당자');
  await page.getByRole('button', { name: '담당자에게 제출', exact: true }).click();
  await expectInputError(page.getByLabel('1회차 경유 (쉼표 구분)'), '1회차 경유 항목을 입력하세요.');
});

test('제출 직전 서버 설정이 바뀌어도 숨김 입력을 열고 필수 오류로 이동한다', async ({ page }) => {
  const s = await setupScenario(database.db);
  await login(page, s.driverUser.login_id, `/d/new?project=${s.project.id}`);
  await fillRoute(page);
  await page.route(
    '**/api/uses/*/submit',
    async (route) => {
      await saveFormSettings(s.adminCtx, {
        project_id: s.project.id,
        fields: [{ field_key: 'requester', driver_mode: 'REQUIRED', manager_mode: null, version: 0 }],
      });
      await route.continue();
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: '담당자에게 제출', exact: true }).click();
  await expectInputError(page.getByLabel('요청자'), '요청자 항목을 입력하세요.');
  await page.getByLabel('요청자').fill('최신 필수값');
  await page.getByRole('button', { name: '담당자에게 제출', exact: true }).click();
  await expect(page.getByText('담당자에게 제출했습니다', { exact: true })).toBeInViewport();
});

test('회당 수량 자동 입력은 완료 운행을 따르고 직접 수정·삭제한 값은 새로고침 후에도 유지한다', async ({
  page,
}) => {
  const s = await setupScenario(database.db);
  await s.f.rate(s.payee.id, { project_id: s.project.id, billing_unit: 'PER_TRIP', unit_price: 100000 });
  await login(page, s.driverUser.login_id, `/d/new?project=${s.project.id}`);
  const quantity = page.getByLabel('청구수량', { exact: true });
  await expect(quantity).toHaveValue('1');
  await expect(page.getByText('운행 1회 기준 자동 입력, 수정 가능', { exact: true })).toBeVisible();
  await fillRoute(page);
  await page.getByRole('button', { name: '직전 회차 복사', exact: true }).click();
  await expect(quantity).toHaveValue('2');
  await quantity.fill('7');
  await page.getByRole('button', { name: '직전 회차 복사', exact: true }).click();
  await expect(quantity).toHaveValue('7');
  await quantity.fill('');
  await expect(page.getByRole('status')).toHaveText('휴대폰에 임시저장됨');
  await page.reload();
  await expect(quantity).toHaveValue('');
  await page.getByRole('button', { name: '직전 회차 복사', exact: true }).click();
  await expect(quantity).toHaveValue('');
  await quantity.fill('5');
  await page.getByRole('button', { name: '서버 저장', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('서버 저장(작성중)');
  const [row] = await database.db.select().from(vehicleUses).where(eq(vehicleUses.driver_id, s.driver.id));
  expect((await getUse(s.driverCtx, row.id)).charge_lines[0]).toMatchObject({
    quantity: '5.000',
    computed_amount: 500000,
  });
});

test('직접 지운 회당 청구수량은 서버 저장 후 재진입해도 자동 입력하지 않는다', async ({ page }) => {
  const s = await setupScenario(database.db);
  await s.f.rate(s.payee.id, { project_id: s.project.id, billing_unit: 'PER_TRIP', unit_price: 100000 });
  await login(page, s.driverUser.login_id, `/d/new?project=${s.project.id}`);
  await fillRoute(page);
  const quantity = page.getByLabel('청구수량', { exact: true });
  await expect(quantity).toHaveValue('1');
  await quantity.fill('');
  await page.getByRole('button', { name: '서버 저장', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('서버 저장(작성중)');
  await expect(quantity).toHaveValue('');
  const [row] = await database.db.select().from(vehicleUses).where(eq(vehicleUses.driver_id, s.driver.id));
  await page.goto(`/d/uses/${row.id}`);
  await expect(page.getByRole('button', { name: '서버 저장', exact: true })).toBeEnabled();
  await expect(quantity).toHaveValue('');
});

for (const policy of ['PHOTO_REQUIRED', 'PHOTO_OR_ALTERNATIVE'] as const) {
  test(`증빙 안내와 오류는 같은 허용 종류를 표시한다: ${policy}`, async ({ page }) => {
    const s = await setupScenario(database.db, { evidence_policy: policy });
    await login(page, s.driverUser.login_id, `/d/new?project=${s.project.id}`);
    await fillRoute(page);
    const phrase =
      '사진·인수증·계근표·확인서 중 1개 이상' + (policy === 'PHOTO_OR_ALTERNATIVE' ? ' 또는 전표번호' : '');
    const evidence = page.locator('[data-fix-target="evidence"]');
    await expect(evidence).toContainText(phrase);
    await page.getByRole('button', { name: '담당자에게 제출', exact: true }).click();
    await expect(evidence.getByRole('alert')).toContainText(phrase);
    await expect(evidence.getByRole('alert')).toBeInViewport();
  });
}

test('취소 운행에는 취소 뱃지를 표시하고 지급 금액을 숨긴다', async ({ page }) => {
  const s = await setupScenario(database.db);
  const use = await createUse(s.driverCtx, s.input);
  await cancelUse(s.driverCtx, use.id, { version: use.version, reason: '취소 회귀' });
  await page.request.post('/api/auth/login', {
    data: { login_id: s.driverUser.login_id, password: 'password1234' },
  });
  await page.goto('/d');
  const card = page.locator(`a[href="/d/uses/${use.id}"]`);
  await expect(card.getByText('취소', { exact: true })).toBeVisible();
  await expect(card).not.toContainText('기본 금액');
  await expect(card).not.toContainText('300,000원');
});

test('기사 상단 로고의 터치 영역은 가로·세로 44px 이상이다', async ({ page }) => {
  const s = await setupScenario(database.db);
  await login(page, s.driverUser.login_id, `/d/new?project=${s.project.id}`);
  const box = await page.getByRole('link', { name: '차량 사용·정산', exact: true }).boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
});
