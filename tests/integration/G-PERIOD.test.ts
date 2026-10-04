import { expect, it } from 'vitest';
import { testDatabase } from '../helpers/database';
import { factories } from '../helpers/factories';
import { saveMaster } from '../../src/server/services/admin';

const database = testDatabase();
it('기존 회사는 19일, 관리자만 1~28 정수 마감일을 저장하고 부분 수정은 보존한다', async () => {
  const f = factories(database().db);
  const ctx = f.context(await f.user());
  const company = await saveMaster(ctx, 'company', { name: '마감 회사', default_tax_mode: 'VAT_EXCLUDED' });
  expect(company.closing_start_day).toBe(19);
  for (const day of [1, 28, 19]) {
    expect(
      (await saveMaster(ctx, 'company', { closing_start_day: day }, String(company.id))).closing_start_day,
    ).toBe(day);
  }
  expect(
    (await saveMaster(ctx, 'company', { name: '이름 변경' }, String(company.id))).closing_start_day,
  ).toBe(19);
  for (const day of [0, 29, 1.5, '19', null]) {
    await expect(
      saveMaster(ctx, 'company', { closing_start_day: day }, String(company.id)),
    ).rejects.toThrow();
  }
  for (const role of ['DRIVER', 'SITE_MANAGER', 'SETTLEMENT_MANAGER'] as const) {
    const user = await f.user({ role, ...(role === 'DRIVER' ? { driver_id: (await f.driver()).id } : {}) });
    await expect(
      saveMaster(f.context(user), 'company', { closing_start_day: 1 }, String(company.id)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  }
  const audit = await database().pool.query(
    "SELECT after FROM audit_logs WHERE entity_type='company_settings' AND action='UPDATE' ORDER BY at DESC LIMIT 1",
  );
  expect(audit.rows[0].after.closing_start_day).toBe(19);
  await expect(
    database().pool.query('UPDATE company_settings SET closing_start_day=29'),
  ).rejects.toMatchObject({ code: '23514' });
});

it('기간 설정 API는 로그인 필수이고 모든 활성 역할에 설정 숫자만 공개한다', async () => {
  const { GET } = await import('../../src/app/api/closing-period/route');
  const { PATCH } = await import('../../src/app/api/admin/[resource]/[id]/route');
  const { callRoute } = await import('../helpers/routes');
  const { randomUUID } = await import('node:crypto');
  const { companySettings, users } = await import('../../src/server/db/schema');
  const { eq } = await import('drizzle-orm');
  const db = database().db;
  const f = factories(db);
  const [company] = await db.select().from(companySettings);
  expect((await callRoute(db, GET)).status).toBe(401);
  for (const role of ['ADMIN', 'DRIVER', 'SITE_MANAGER', 'SETTLEMENT_MANAGER'] as const) {
    const user = await f.user({ role, ...(role === 'DRIVER' ? { driver_id: (await f.driver()).id } : {}) });
    const session = await f.session(user.id);
    const patch = await callRoute(db, PATCH, {
      token: session.token,
      method: 'PATCH',
      params: { resource: 'company', id: company.id },
      body: { closing_start_day: 28 },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(patch.status).toBe(role === 'ADMIN' ? 200 : 403);
    const response = await callRoute(db, GET, { token: session.token });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { closing_start_day: 28, today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
    });
    await db.update(users).set({ status: 'DISABLED' }).where(eq(users.id, user.id));
    expect((await callRoute(db, GET, { token: session.token })).status).toBe(401);
  }
});
