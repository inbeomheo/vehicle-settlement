import { expect, test } from '@playwright/test';
import { createDatabase } from '../../src/server/db/client';
import { setupScenario } from '../helpers/factories';
import { createUse, submitUse } from '../../src/server/services/uses';

const database = createDatabase(process.env.DATABASE_URL!);
test.afterAll(async () => database.pool.end());
test.setTimeout(90000);

test('SEC2-01 현장 담당자 사용 상세·제출 당시 내용은 연락처만 표시하고 사업자·계좌를 숨긴다', async ({
  page,
}) => {
  const s = await setupScenario(database.db);
  await database.pool.query('UPDATE counterparties SET biz_no=$1 WHERE id=$2', ['778-81-98765', s.payee.id]);
  const use = await createUse(s.adminCtx, s.input);
  await submitUse(s.adminCtx, use.id, { version: use.version });
  await database.pool.query(
    'UPDATE use_revisions SET snapshot=snapshot || $1::jsonb WHERE vehicle_use_id=$2',
    [JSON.stringify({ payee: { bank_account: '비공개계좌-98765' } }), use.id],
  );
  const manager = await s.f.user({ role: 'SITE_MANAGER' });
  await s.f.assignment(manager.id, s.project.id);
  expect(
    (
      await page.request.post('/api/auth/login', {
        data: { login_id: manager.login_id, password: 'password1234' },
      })
    ).ok(),
  ).toBe(true);
  await page.goto(`/m/uses/${use.id}`);
  await expect(page.getByRole('heading', { name: use.use_no, exact: true })).toBeVisible();
  await expect(page.getByText(s.driver.phone!, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '제출·검수 이력', exact: true }).click();
  await page.getByText('제출 당시 내용', { exact: true }).click();
  await expect(page.locator('pre')).toContainText(s.driver.phone!);
  await expect(page.locator('pre')).not.toContainText('778-81-98765');
  await expect(page.locator('pre')).not.toContainText('비공개계좌-98765');
});

test('SEC2-02 내 정보에서 비활성 기사 차량 변경을 거부하고 SEC2-03 연락처 저장은 운송사를 유지한다', async ({
  page,
}) => {
  const s = await setupScenario(database.db);
  await database.pool.query('UPDATE counterparties SET biz_no=$1 WHERE id=$2', ['443-32-98765', s.payee.id]);
  const vehicle = await s.f.vehicle({ vehicle_type: '덤프', tonnage: '25' });
  await s.f.driver({ active: false, default_vehicle_id: vehicle.id });
  expect(
    (
      await page.request.post('/api/auth/login', {
        data: { login_id: s.driverUser.login_id, password: 'password1234' },
      })
    ).ok(),
  ).toBe(true);
  await page.goto('/d/profile');
  await page.getByLabel('전화번호', { exact: true }).fill('01056789876');
  await page.getByLabel('차량번호', { exact: true }).fill(vehicle.plate_no);
  await page.getByRole('button', { name: '정보 저장', exact: true }).click();
  await expect(page.locator('form').getByRole('alert')).toContainText(
    '이미 다른 기사님 차량으로 등록된 번호예요. 관리자에게 문의해 주세요.',
  );
  await page.getByLabel('차량번호', { exact: true }).fill(s.vehicle.plate_no);
  await page.getByRole('button', { name: '정보 저장', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '내 정보를 저장했습니다.' })).toBeVisible();
  expect(
    (
      await database.pool.query(
        'SELECT counterparty_id FROM driver_affiliations WHERE driver_id=$1 AND valid_to IS NULL',
        [s.driver.id],
      )
    ).rows,
  ).toEqual([{ counterparty_id: s.payee.id }]);
  expect(
    (await database.pool.query('SELECT vehicle_type,tonnage FROM vehicles WHERE id=$1', [vehicle.id]))
      .rows[0],
  ).toEqual({ vehicle_type: '덤프', tonnage: '25.000' });
});
