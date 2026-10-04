import { expect, test } from '@playwright/test';
import { createDatabase } from '../../src/server/db/client';
import { setupScenario } from '../helpers/factories';
import { fillFlowFields } from './submit-helper';

async function prepare() {
  const database = createDatabase(process.env.DATABASE_URL!);
  try {
    const s = await setupScenario(database.db);
    const manager = await s.f.user({ role: 'SITE_MANAGER' });
    await s.f.assignment(manager.id, s.project.id);
    const driver = await s.f.driver({ name: '계정 없는 신규 기사' });
    const vehicle = await s.f.vehicle();
    const payee = await s.f.counterparty({ kind: 'DRIVER_BUSINESS', name: '새 기사 지급처' });
    await s.f.affiliation(driver.id, payee.id);
    await s.f.rate(payee.id);
    return { s, manager, driver, vehicle, payee };
  } finally {
    await database.pool.end();
  }
}

test('새 기사 대리 입력 선택과 현장 담당자 가져오기 경고·일반 행 페이지·제외', async ({ page }) => {
  const { s, manager, driver, vehicle, payee } = await prepare();
  await page.request.post('/api/auth/login', {
    data: { login_id: manager.login_id, password: 'password1234' },
  });
  await page.goto('/m/uses/new');
  await expect(
    page.getByRole('combobox', { name: '실제 기사', exact: true }).locator(`option[value="${driver.id}"]`),
  ).toHaveText(driver.name);
  await page.getByLabel('실제 기사', { exact: true }).selectOption(driver.id);
  await page.getByLabel('차량', { exact: true }).selectOption(vehicle.id);
  await fillFlowFields(page);
  await page.getByLabel('1회차 출발', { exact: true }).fill('새 기사 출발');
  await page.getByLabel('1회차 도착', { exact: true }).fill('새 기사 도착');
  const saved = page.waitForResponse(
    (response) => response.url().endsWith('/api/uses') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '서버 저장', exact: true }).click();
  const savedResponse = await saved;
  expect(savedResponse.ok()).toBe(true);
  const savedUse = (await savedResponse.json()).data;
  expect(savedUse).toMatchObject({
    entered_as: 'PROXY',
    driver_id: driver.id,
    vehicle_id: vehicle.id,
    payee_counterparty_id: payee.id,
  });
  // 저장 응답 뒤 IndexedDB 동기화와 location.assign이 끝나야 다음 이동과 경합하지 않는다.
  await expect(page).toHaveURL(`/m/uses/${savedUse.id}`);
  await page.goto('/m/import');
  const header = '사용일,현장,기사,차량번호,지급처,출발지,도착지,과금단위,단가';
  const rows = Array.from(
    { length: 205 },
    (_, i) =>
      `2026-09-15,${s.project.id},${driver.id},${vehicle.id},${payee.id},출발,도착${i},일대,${i === 101 ? 310000 : 300000}`,
  );
  await page.getByLabel('가져올 파일').setInputFiles({
    name: '경고와페이지.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from([header, ...rows].join('\n')),
  });
  await page.getByRole('button', { name: '미리보기 검증' }).click();
  await expect(page.getByRole('status').filter({ hasText: '유효 205건' })).toBeVisible();
  await expect(page.getByText('계약 단가 300,000원과 파일 단가가 다릅니다.')).toBeVisible();
  await expect(page.getByText(/전체 205행.*경고 1행/)).toBeVisible();
  await page.getByLabel('103행 제외').check();
  await page.getByRole('button', { name: '다음 100행' }).click();
  await expect(page.getByLabel('202행 제외')).toBeVisible();
  await expect(page.getByLabel('103행 제외')).toBeChecked();
  await page.getByLabel('202행 제외').check();
  await page.getByRole('button', { name: '미리보기 검증' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: '유효 203건 · 오류 0건 · 건너뜀 2건' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '유효 행 임시저장' }).click();
  await expect(page.getByRole('status').filter({ hasText: '203건을 임시저장' })).toBeVisible();
});

test('파일 상한 안내와 선택 즉시 검사로 큰 파일 업로드를 보내지 않는다', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { login_id: 'site', password: 'demo1234' } });
  await page.goto('/m/import');
  await expect(page.getByText(/xlsx \/ csv 파일/)).not.toContainText('10MB');
  let uploads = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/import/upload')) uploads++;
  });
  await page
    .getByLabel('가져올 파일')
    .setInputFiles({ name: '큰파일.csv', mimeType: 'text/csv', buffer: Buffer.alloc(4 * 1024 * 1024, 32) });
  await expect(page.locator('main').getByRole('alert')).toContainText('나눠');
  expect(uploads).toBe(0);
});
