import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createDatabase } from '../../src/server/db/client';
import { setupScenario } from '../helpers/factories';
import { createInvite } from '../../src/server/services/auth';
import { createJoinLink } from '../../src/server/services/driver-join';
import { createUse } from '../../src/server/services/uses';
import { saveMaster } from '../../src/server/services/admin';

const database = createDatabase(process.env.DATABASE_URL!);
test.afterAll(async () => database.pool.end());
test.setTimeout(90000);
const stoppedMessage = '초대한 현장이 지금 사용 중지 상태예요. 관리자에게 새 초대를 요청해 주세요.';

test('SEC3-03 중지된 현장 초대 수락 안내 후 같은 초대로 재시도할 수 있다', async ({ page }) => {
  const s = await setupScenario(database.db);
  const driver = await s.f.driver();
  const invite = await createInvite(s.adminCtx, {
    role: 'DRIVER',
    name: '초대 기사',
    driver_id: driver.id,
    project_ids: [s.project.id],
  });
  await saveMaster(s.adminCtx, 'projects', { active: false }, s.project.id);
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto(new URL(invite.invite_url).pathname);
  await page.getByLabel('아이디', { exact: true }).fill(randomUUID());
  await page.getByLabel('비밀번호', { exact: true }).fill('password1234');
  await page.getByRole('button', { name: '가입하고 시작하기', exact: true }).click();
  await expect(page.locator('form').getByRole('alert')).toContainText(stoppedMessage);
  expect((await page.request.get('/api/me')).status()).toBe(401);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await saveMaster(s.adminCtx, 'projects', { active: true }, s.project.id);
  await page.getByRole('button', { name: '가입하고 시작하기', exact: true }).click();
  await expect(page).toHaveURL(/\/d$/);
  expect(
    (await (await page.request.get('/api/lookups')).json()).data.projects.map((p: { id: string }) => p.id),
  ).toEqual([s.project.id]);
});

test('SEC3-03 일부 중지된 가입 링크는 활성 현장만 표시하며 가입 화면을 연다', async ({ page }) => {
  const s = await setupScenario(database.db);
  const stopped = await s.f.project({ name: '중지된 초대 현장' });
  const link = await createJoinLink(s.adminCtx, { project_ids: [s.project.id, stopped.id] });
  await saveMaster(s.adminCtx, 'projects', { active: false }, stopped.id);
  await page.goto(new URL(link.join_url).pathname);
  await expect(page.getByRole('button', { name: '가입하고 시작하기' })).toBeEnabled();
  await expect(page.getByText(`담당 현장: ${s.project.name}`, { exact: true })).toBeVisible();
  await expect(page.getByText(stopped.name, { exact: false })).toHaveCount(0);
});

test('SEC3-01 타인이 만든 미승인 운행이 있어도 내 정보에서 차량 톤수를 수정한다', async ({ page }) => {
  const s = await setupScenario(database.db);
  await database.pool.query('UPDATE counterparties SET biz_no=$1 WHERE id=$2', ['553-44-99887', s.payee.id]);
  const other = await s.f.driver();
  await s.f.affiliation(other.id, s.payee.id);
  const otherUser = await s.f.user({ role: 'DRIVER', driver_id: other.id });
  const old = await createUse(s.adminCtx, { ...s.input, driver_id: other.id });
  await database.pool.query(
    "UPDATE vehicle_uses SET entered_as='DRIVER_SELF',created_by_user_id=$1 WHERE id=$2",
    [otherUser.id, old.id],
  );
  expect(
    (
      await page.request.post('/api/auth/login', {
        data: { login_id: s.driverUser.login_id, password: 'password1234' },
      })
    ).ok(),
  ).toBe(true);
  await page.goto('/d/profile');
  await page.getByLabel('전화번호', { exact: true }).fill('01098769876');
  await page.getByLabel('차량 최대 적재 (톤)', { exact: true }).fill('8.5');
  await page.getByRole('button', { name: '정보 저장', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '내 정보를 저장했습니다.' })).toBeVisible();
  await expect(page.getByLabel('차량 최대 적재 (톤)', { exact: true })).toHaveValue('8.500');
});
