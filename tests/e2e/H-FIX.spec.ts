import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../../src/server/db/client';
import { counterparties, drivers } from '../../src/server/db/schema';
import { setupScenario } from '../helpers/factories';
import { createJoinLink, registerDriver } from '../../src/server/services/driver-join';
import { createUse, submitUse, approveUse, reviewChargeLine } from '../../src/server/services/uses';

async function prepare() {
  const database = createDatabase(process.env.DATABASE_URL!);
  try {
    const s = await setupScenario(database.db);
    const suffix = randomUUID().replace(/\D/g, '').padEnd(10, '0').slice(0, 10);
    await database.db
      .update(drivers)
      .set({ name: `회귀기사-${s.driver.id}`, phone: `010${suffix.slice(0, 8)}` })
      .where(eq(drivers.id, s.driver.id));
    const details = {
      representative_name: '원장 대표',
      address: '원장 주소',
      business_type: '운수',
      business_item: '화물',
    };
    const target = await s.f.counterparty({
      ...details,
      name: `공유사업-${suffix}`,
      kind: 'DRIVER_BUSINESS',
      biz_no: `900-${suffix.slice(3, 5)}-${suffix.slice(5)}`,
    });
    await s.f.affiliation((await s.f.driver()).id, target.id);
    await database.db
      .update(counterparties)
      .set({
        kind: 'DRIVER_BUSINESS',
        biz_no: `901-${suffix.slice(3, 5)}-${suffix.slice(5)}`,
        representative_name: '이전 대표',
        address: '이전 주소',
      })
      .where(eq(counterparties.id, s.payee.id));
    return {
      login: s.admin.login_id,
      driver: s.driver.id,
      user: s.driverUser.id,
      target,
      details,
      project: s.project.id,
    };
  } finally {
    await database.pool.end();
  }
}

test('기사관리에서 기존 사업자번호를 입력하면 원장 상세를 채우고 읽기 전용으로 저장한다', async ({
  page,
}) => {
  const s = await prepare();
  await page.request.post('/api/auth/login', { data: { login_id: s.login, password: 'password1234' } });
  await page.goto('/m/drivers');
  await page
    .getByRole('row')
    .filter({ hasText: `회귀기사-${s.driver}` })
    .getByRole('button', { name: '정보 수정', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('사업자번호', { exact: true }).fill(s.target.biz_no!);
  await expect(dialog.getByLabel('대표자 (선택)', { exact: true })).toHaveValue('원장 대표');
  await expect(dialog.getByLabel('상호명', { exact: true })).toHaveValue(s.target.name);
  for (const title of ['상호명', '대표자 (선택)', '사업장 주소 (선택)', '업태 (선택)', '종목 (선택)'])
    await expect(dialog.getByLabel(title, { exact: true })).toHaveAttribute('readonly', '');
  await dialog.getByRole('button', { name: '정보 저장', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const profile = await (await page.request.get(`/api/drivers/${s.user}`)).json();
  expect(profile.data).toMatchObject({ ...s.details, business_name: s.target.name });
});

for (const manager of [true, false])
  test(`번호 없는 운송사 지정 링크 가입 후 ${manager ? '관리자' : '본인'} 연락처 수정`, async ({ page }) => {
    const database = createDatabase(process.env.DATABASE_URL!);
    let login: string;
    let userId: string;
    let driverName: string;
    try {
      const s = await setupScenario(database.db);
      const suffix = randomUUID().replace(/\D/g, '').padEnd(8, '0').slice(0, 8);
      const link = await createJoinLink(s.adminCtx, {
        project_ids: [s.project.id],
        counterparty_id: s.payee.id,
      });
      driverName = `번호없는소속-${suffix}`;
      const input = {
        client_request_id: randomUUID(),
        login_id: randomUUID(),
        password: 'password1234',
        profile: {
          name: driverName,
          phone: `010${suffix}`,
          plate_no: `회귀${suffix}`,
          vehicle_type: '카고',
          tonnage: '8',
        },
      };
      const registered = await registerDriver(
        database.db,
        randomUUID(),
        new URL(link.join_url).pathname.split('/').at(-1)!,
        input,
      );
      userId = registered.user.id;
      login = manager ? s.admin.login_id : input.login_id;
    } finally {
      await database.pool.end();
    }
    await page.request.post('/api/auth/login', { data: { login_id: login, password: 'password1234' } });
    await page.goto(manager ? '/m/drivers' : '/d/profile');
    if (manager)
      await page
        .getByRole('row')
        .filter({ hasText: driverName })
        .getByRole('button', { name: '정보 수정', exact: true })
        .click();
    const phone = `010${randomUUID().replace(/\D/g, '').padEnd(8, '0').slice(0, 8)}`;
    await page.getByLabel('전화번호', { exact: true }).fill(phone);
    const response = page.waitForResponse(
      (r) =>
        r.request().method() === 'PATCH' &&
        r.url().endsWith(manager ? `/api/drivers/${userId}` : '/api/driver-profile'),
    );
    await page.getByRole('button', { name: '정보 저장', exact: true }).click();
    expect((await response).ok()).toBe(true);
    const saved = await (
      await page.request.get(manager ? `/api/drivers/${userId}` : '/api/driver-profile')
    ).json();
    expect(saved.data).toMatchObject({ phone, biz_no: null });
  });

for (const width of [1280, 1440])
  test(`${width}px 기준정보의 거래처·기사·차량·현장·소속·회사·단가 관리가 가로 스크롤 없이 보인다`, async ({
    page,
  }) => {
    const s = await prepare();
    await page.setViewportSize({ width, height: 1000 });
    await page.request.post('/api/auth/login', { data: { login_id: s.login, password: 'password1234' } });
    for (const resource of [
      'counterparties',
      'drivers',
      'vehicles',
      'projects',
      'affiliations',
      'company',
      'rates',
      'work-types',
    ]) {
      await page.goto(`/m/master/${resource}`);
      const table = page.getByRole('table');
      const edit = table.getByRole('button', { name: '수정', exact: true }).first();
      await expect(edit).toBeVisible();
      expect
        .soft(
          await table.evaluate((el) => el.parentElement!.scrollWidth <= el.parentElement!.clientWidth),
          resource,
        )
        .toBe(true);
      const rect = (await edit.boundingBox())!;
      expect.soft(rect.x + rect.width, resource).toBeLessThanOrEqual(width);
      expect
        .soft(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), resource)
        .toBe(true);
      if (resource === 'counterparties') {
        await page.screenshot({ path: test.info().outputPath(`counterparties-${width}.png`) });
        await edit.click();
        await expect(page.getByLabel('대표자', { exact: true })).toBeVisible();
        await expect(page.getByLabel('사업장 주소', { exact: true })).toBeVisible();
      }
    }
  });

test('결재 상단은 보류액을 분리하고 기본운임 반려 건의 통행료는 선택 승인한다', async ({ page }) => {
  const database = createDatabase(process.env.DATABASE_URL!);
  let login: string;
  let project: string;
  try {
    const s = await setupScenario(database.db);
    login = s.admin.login_id;
    project = s.project.id;
    for (const held of [true, false]) {
      let use = await createUse(s.driverCtx, {
        ...s.input,
        charge_lines: [
          { charge_type: 'BASE', requested_amount: 300000 },
          { charge_type: 'TOLL', requested_amount: 50000, reason: '통행료' },
        ],
      });
      use = await submitUse(s.driverCtx, use.id, { version: use.version });
      let reviewed = await reviewChargeLine(
        s.adminCtx,
        use.charge_lines.find((l) => l.charge_type === (held ? 'TOLL' : 'BASE'))!.id,
        { version: use.version, line_review_status: held ? 'HELD' : 'REJECTED' },
      );
      if (held) await approveUse(s.adminCtx, use.id, { version: reviewed.use_version });
      else
        reviewed = await reviewChargeLine(
          s.adminCtx,
          use.charge_lines.find((l) => l.charge_type === 'TOLL')!.id,
          { version: reviewed.use_version, line_review_status: 'APPROVED' },
        );
    }
  } finally {
    await database.pool.end();
  }
  await page.request.post('/api/auth/login', { data: { login_id: login, password: 'password1234' } });
  await page.goto(`/m/approvals?from=2026-09-01&to=2026-09-30&project_id=${project}`);
  const total = page.getByRole('status').filter({ hasText: '기간 합계' });
  await expect(total).toContainText('2건 · 350,000원');
  await expect(total).toContainText('보류 50,000원');
  await page.getByRole('button', { name: '승인 가능 모두 선택', exact: true }).click();
  await expect(page.getByRole('button', { name: '선택 승인 (1)', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '선택 승인 (1)', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '1건 승인' })).toBeVisible();
});
