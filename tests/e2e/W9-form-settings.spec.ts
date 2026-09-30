import { expect, test, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../../src/server/db/client';
import { vehicleUses } from '../../src/server/db/schema';
import { setupScenario } from '../helpers/factories';
import { getAdminFormSettings, saveFormSettings } from '../../src/server/services/form-settings';
import { getUse } from '../../src/server/services/uses';
import { submitDriverForm } from './submit-helper';

const database = createDatabase(process.env.DATABASE_URL!);
test.use({ viewport: { width: 390, height: 844 }, actionTimeout: 15000 });
test.setTimeout(120000);
test.afterAll(async () => database.pool.end());
async function login(page: Page, login_id: string, path = '/d/new') {
  await page.request.post('/api/auth/login', { data: { login_id, password: 'password1234' } });
  await page.goto(path);
}
async function fillTrip(page: Page) {
  await page.getByLabel('1회차 출발', { exact: true }).fill('자재 창고');
  await page.getByLabel('1회차 도착', { exact: true }).fill('서울 현장');
}
async function mobileSize(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect(
    await page.locator('main input:not([type=file]),main select,main textarea').evaluateAll((elements) =>
      elements
        .filter(
          (element) =>
            element.getBoundingClientRect().height > 0 &&
            (parseFloat(getComputedStyle(element).fontSize) < 16 ||
              // 라디오·체크박스는 감싼 label 전체가 터치 영역이다.
              (element.closest('label') ?? element).getBoundingClientRect().height < 44),
        )
        .map((element) => element.outerHTML),
    ),
  ).toEqual([]);
}

test('390px 기본 기사 폼은 최소 항목과 추가비 버튼만 표시하고 증빙 첨부 후 제출', async ({ page }) => {
  const s = await setupScenario(database.db, { evidence_policy: 'PHOTO_REQUIRED' });
  await login(page, s.driverUser.login_id);
  const projectChip = page.locator(`input[name="project_id"][value="${s.project.id}"]`);
  await expect(page.getByRole('radiogroup', { name: '현장' })).toBeVisible();
  await projectChip.check();
  await fillTrip(page);
  for (const label of [
    '공종 (선택)',
    '요청자',
    '종료일 (선택)',
    '전체 운행 상태',
    '특이사항',
    '1회차 경유 (쉼표 구분)',
    '1회차 화물',
    '1회차 수량',
    '1회차 시간',
    '1회차 출발시각 (서울)',
    '1회차 도착시각 (서울)',
    '1회차 운행 상태',
    '1회차 공차회차',
    '1회차 비고',
  ])
    await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
  await expect(page.getByText('1회차 상세 입력', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('운반 내용', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ 추가 비용', exact: true })).toBeVisible();
  await expect(page.getByLabel('추가비 1 종류', { exact: true })).toHaveCount(0);
  // 차량이 적으면 번호판 칩(radio), 많으면 드롭다운으로 표시된다.
  await expect(
    page.locator(
      `input[name="vehicle_id"][value="${s.vehicle.id}"]:checked, option[value="${s.vehicle.id}"]:checked`,
    ),
  ).toHaveCount(1);
  await expect(page.getByText('기본운임 300,000원', { exact: true })).toBeVisible();
  await mobileSize(page);
  await page.screenshot({ path: 'test-results/W9-minimal-390.png', fullPage: true });
  await page.getByLabel('사진·파일 선택', { exact: true }).setInputFiles('public/icons/icon-192.png');
  await submitDriverForm(page);
  // 사진 업로드 직후 제출이라 병렬 실행 부하에서는 5초를 넘길 수 있다.
  await expect(page.getByRole('status')).toHaveText('담당자에게 보냈습니다', { timeout: 20000 });
  const rows = await database.db.select().from(vehicleUses).where(eq(vehicleUses.driver_id, s.driver.id));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ review_status: 'SUBMITTED', requester: '', work_type_id: null });
});

test('관리자 회사 필수 변경 → 열린 기사 폼 제출 전 검사, 현장별 재정의·해제·감사로그', async ({
  page,
  browser,
}) => {
  const s = await setupScenario(database.db);
  const b = await s.f.project({ name: 'W9 현장 B' });
  await s.f.assignment(s.driverUser.id, b.id);
  const original = await getAdminFormSettings(s.adminCtx);
  const driverContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const driverPage = await driverContext.newPage();
  try {
    await login(driverPage, s.driverUser.login_id);
    await driverPage.locator(`input[name="project_id"][value="${b.id}"]`).check();
    await fillTrip(driverPage);
    await login(page, s.admin.login_id, '/m/master');
    await page.getByRole('link', { name: /입력 항목 설정/ }).click();
    await page.getByRole('button', { name: /사용 정보.*펼치기/ }).click();
    await page
      .getByRole('radiogroup', { name: '요청자 · 기사', exact: true })
      .getByRole('radio', { name: '필수' })
      .check();
    await expect(page.getByRole('region', { name: '기사 폼 미리보기' })).toContainText('요청자 · 필수');
    await page.getByRole('button', { name: '설정 저장', exact: true }).click();
    await expect(page.getByText('입력 항목 설정을 저장했습니다. 변경 이력에 기록되었습니다.')).toBeVisible();
    await mobileSize(page);
    await page.screenshot({ path: 'test-results/W9-admin-390.png', fullPage: true });
    await submitDriverForm(driverPage);
    await expect(driverPage.locator('#form-errors')).toContainText('요청자 항목을 입력하세요.');
    await expect(driverPage.getByLabel(/요청자.*필수/)).toHaveAttribute('aria-required', 'true');
    expect(
      await database.db.select().from(vehicleUses).where(eq(vehicleUses.driver_id, s.driver.id)),
    ).toHaveLength(0);
    await page.getByLabel('설정할 현장', { exact: true }).selectOption(s.project.id);
    // 현장 재정의가 없으면 회사 기본값(필수)을 따른다.
    const requesterDriver = page.getByRole('radiogroup', { name: '요청자 · 기사', exact: true });
    await expect(requesterDriver.getByRole('radio', { name: '필수' })).toBeChecked();
    await expect(page.getByLabel('요청자 설정').getByText('회사 기본 따름')).toHaveCount(2);
    await requesterDriver.getByRole('radio', { name: '숨김' }).check();
    await page.getByRole('button', { name: '설정 저장', exact: true }).click();
    await expect(page.getByText('입력 항목 설정을 저장했습니다. 변경 이력에 기록되었습니다.')).toBeVisible();
    await driverPage.locator(`input[name="project_id"][value="${s.project.id}"]`).check();
    await expect(driverPage.getByLabel('요청자', { exact: true })).toBeVisible();
    await expect(driverPage.getByLabel('요청자', { exact: true })).toHaveValue('');
    await expect(driverPage.locator('[data-fix-target="requester"]')).not.toContainText(
      '관리자 설정상 숨김 항목입니다',
    );
    await driverPage.locator(`input[name="project_id"][value="${b.id}"]`).check();
    await expect(driverPage.getByLabel(/요청자.*필수/)).toBeVisible();
    await driverPage.getByLabel(/요청자.*필수/).fill('현장 담당자');
    await submitDriverForm(driverPage);
    await expect(driverPage.getByRole('status')).toHaveText('담당자에게 보냈습니다');
    await page
      .getByRole('region', { name: '요청자 설정', exact: true })
      .getByRole('button', { name: '재정의 해제' })
      .click();
    await page.getByRole('button', { name: '설정 저장', exact: true }).click();
    await expect(page.getByText('입력 항목 설정을 저장했습니다. 변경 이력에 기록되었습니다.')).toBeVisible();
    await driverPage.locator(`input[name="project_id"][value="${s.project.id}"]`).check();
    await expect(driverPage.getByLabel(/요청자.*필수/)).toBeVisible();
    await page.getByRole('link', { name: '변경 이력', exact: true }).last().click();
    await page.getByRole('button', { name: '필터 펼치기 +', exact: true }).click();
    await page.getByLabel('대상 유형').selectOption('form_field_setting');
    await page.getByRole('button', { name: '이력 조회', exact: true }).click();
    await expect(page.getByText('입력 항목 설정 변경', { exact: true }).first()).toBeVisible();
  } finally {
    const current = await getAdminFormSettings(s.adminCtx);
    const row = current.fields.find((row) => row.field_key === 'requester')!;
    const prior = original.fields.find((row) => row.field_key === 'requester')!;
    await saveFormSettings(s.adminCtx, { project_id: null, fields: [{ ...prior, version: row.version }] });
    await driverContext.close();
  }
});

test('현장 설정 IndexedDB 캐시로 오프라인 재시작·필수 검사·추가비 숨김, 연결 후 최신 정책 재검사', async ({
  page,
  context,
}) => {
  const s = await setupScenario(database.db);
  await saveFormSettings(s.adminCtx, {
    project_id: s.project.id,
    fields: [
      { field_key: 'via', driver_mode: 'REQUIRED', manager_mode: null, version: 0 },
      { field_key: 'extra_charges', driver_mode: 'HIDDEN', manager_mode: null, version: 0 },
    ],
  });
  await login(page, s.driverUser.login_id);
  await fillTrip(page);
  await expect(page.getByLabel(/1회차 경유.*필수/)).toBeVisible();
  await expect(page.getByRole('button', { name: '+ 추가 비용', exact: true })).toHaveCount(0);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.getByRole('status')).toHaveText('휴대폰에만 저장됨');
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(
    page.getByText('마지막으로 받은 입력 항목 설정을 사용합니다. 제출 시 서버에서 다시 확인합니다.'),
  ).toBeVisible();
  await expect(page.getByLabel(/1회차 경유.*필수/)).toBeVisible();
  await expect(page.getByLabel('1회차 출발시각 (서울)', { exact: true })).toHaveCount(0);
  await submitDriverForm(page);
  await expect(page.locator('#form-errors')).toContainText('1회차 경유 항목을 입력하세요.');
  await page.getByLabel(/1회차 경유.*필수/).fill('중간 창고');
  await submitDriverForm(page);
  await expect(page.getByRole('status')).toContainText('제출 대기');
  await saveFormSettings(s.adminCtx, {
    project_id: s.project.id,
    fields: [{ field_key: 'requester', driver_mode: 'REQUIRED', manager_mode: null, version: 0 }],
  });
  await context.setOffline(false);
  await expect(page.locator('#form-errors')).toContainText('요청자');
  await expect(page.getByLabel(/요청자.*필수/)).toBeVisible();
  await page.getByLabel(/요청자.*필수/).fill('현장 담당');
  await submitDriverForm(page);
  await expect(page.getByRole('status')).toHaveText('담당자에게 보냈습니다');
  const [row] = await database.db.select().from(vehicleUses).where(eq(vehicleUses.driver_id, s.driver.id));
  expect((await getUse(s.driverCtx, row.id)).trips[0].via).toEqual(['중간 창고']);
});

test('관리자 동시 편집 충돌은 덮어쓰지 않고 최신 설정 불러오기 제공', async ({ page }) => {
  const s = await setupScenario(database.db);
  await login(page, s.admin.login_id, '/m/master/form-fields');
  await page.getByRole('button', { name: /사용 정보.*펼치기/ }).click();
  await page.getByLabel('설정할 현장', { exact: true }).selectOption(s.project.id);
  await page
    .getByRole('radiogroup', { name: '요청자 · 기사', exact: true })
    .getByRole('radio', { name: '선택' })
    .check();
  await saveFormSettings(s.adminCtx, {
    project_id: s.project.id,
    fields: [{ field_key: 'requester', driver_mode: 'REQUIRED', manager_mode: null, version: 0 }],
  });
  await page.getByRole('button', { name: '설정 저장', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('입력 항목 설정이 변경되었습니다.');
  await page.getByRole('button', { name: '최신 설정 불러오기 (현재 편집 초기화)' }).click();
  await expect(
    page.getByRole('radiogroup', { name: '요청자 · 기사', exact: true }).getByRole('radio', { name: '필수' }),
  ).toBeChecked();
  await expect(page.getByRole('button', { name: '설정 저장', exact: true })).toBeDisabled();
});
