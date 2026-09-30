import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { testDatabase } from '../helpers/database';
import { factories } from '../helpers/factories';
import { callRoute } from '../helpers/routes';
import { POST as createRoute } from '../../src/app/api/admin/users/[id]/password-reset/route';
import { POST as changeRoute } from '../../src/app/api/auth/password/route';
import { GET as statusRoute, POST as resetRoute } from '../../src/app/api/password-resets/[token]/route';
import {
  createPasswordReset,
  getPasswordResetStatus,
  resetPassword,
  changePassword,
  resetPasswordSchema,
} from '../../src/server/services/password';
import { login } from '../../src/server/services/auth';
import { authenticate } from '../../src/server/auth/session';
import { loginThrottleKey } from '../../src/server/auth/login-throttle';
import { auditLogs, idempotencyKeys, passwordResets, sessions, users } from '../../src/server/db/schema';

const database = testDatabase();
const newPassword = { password: 'new-password1234', password_confirmation: 'new-password1234' };
const tokenOf = (link: { reset_url: string }) => new URL(link.reset_url).pathname.split('/').at(-1)!;
async function fixture(role: 'ADMIN' | 'SITE_MANAGER' | 'SETTLEMENT_MANAGER' | 'DRIVER' = 'ADMIN') {
  const { db } = database();
  const f = factories(db);
  const user = await f.user({ role, ...(role === 'DRIVER' ? { driver_id: (await f.driver()).id } : {}) });
  const session = await f.session(user.id);
  return { db, f, user, session, ctx: { ...f.context(user), session_id: session.session.id } };
}
it('ADMIN만 생성 가능, 본인도 허용하며 비활성 사용자는 거부한다', async () => {
  for (const role of ['ADMIN', 'SITE_MANAGER', 'SETTLEMENT_MANAGER', 'DRIVER'] as const) {
    const { db, user, session, ctx } = await fixture(role);
    const response = await callRoute(db, createRoute, {
      method: 'POST',
      token: session.token,
      params: { id: user.id },
    });
    expect(response.status).toBe(role === 'ADMIN' ? 200 : 403);
    if (role !== 'ADMIN')
      await expect(createPasswordReset(ctx, user.id)).rejects.toMatchObject({ status: 403 });
  }
  const { db, f, ctx } = await fixture();
  const disabled = await f.user({ status: 'DISABLED' });
  await expect(createPasswordReset(ctx, disabled.id)).rejects.toMatchObject({ status: 422 });
  expect((await callRoute(db, createRoute, { method: 'POST', params: { id: ctx.user.id } })).status).toBe(
    401,
  );
});
it('새 링크는 이전 링크 폐기, 24시간 유효, 해시만 저장하고 멱등 재응답·감사에서 비밀 제거', async () => {
  const { db, user, session, ctx } = await fixture();
  const first = await createPasswordReset(ctx, user.id);
  const key = randomUUID();
  const options = {
    method: 'POST',
    path: `/api/admin/users/${user.id}/password-reset`,
    token: session.token,
    params: { id: user.id },
    headers: { 'idempotency-key': key },
  };
  const response = await callRoute(db, createRoute, options);
  const second = (await response.json()).data;
  expect(new Date(second.expires_at).getTime() - Date.now()).toBeGreaterThan(86390000);
  expect(new Date(second.expires_at).getTime() - Date.now()).toBeLessThanOrEqual(86400000);
  expect(await getPasswordResetStatus(db, tokenOf(first))).toMatchObject({ status: 'INVALID', name: null });
  expect(await getPasswordResetStatus(db, tokenOf(second))).toMatchObject({
    status: 'VALID',
    name: user.name,
    login_id: user.login_id,
  });
  const replay = await callRoute(db, createRoute, options);
  expect((await replay.json()).data).not.toHaveProperty('reset_url');
  const stored = JSON.stringify([await db.select().from(auditLogs), await db.select().from(idempotencyKeys)]);
  expect(stored).not.toContain(tokenOf(second));
  expect(stored).not.toContain('token_hash');
  expect(stored).not.toContain('password_hash');
  const [row] = await db.select().from(passwordResets).where(eq(passwordResets.id, first.id));
  expect(row.revoked_at).not.toBeNull();
  expect(row.token_hash).not.toBe(tokenOf(first));
});
it('만료·잘못된 링크·비활성 계정·폐기된 링크는 정보 노출 없이 거부', async () => {
  const { db, user, ctx } = await fixture();
  const link = await createPasswordReset(ctx, user.id);
  await db
    .update(passwordResets)
    .set({ expires_at: new Date(Date.now() - 1) })
    .where(eq(passwordResets.id, link.id));
  for (const token of [tokenOf(link), 'wrong-token']) {
    expect((await callRoute(db, statusRoute, { params: { token } })).status).toBe(200);
    expect(await getPasswordResetStatus(db, token)).toEqual({
      status: 'INVALID',
      name: null,
      login_id: null,
    });
    const response = await callRoute(db, resetRoute, {
      method: 'POST',
      params: { token },
      body: newPassword,
    });
    expect(response.status).toBe(404);
    expect((await response.json()).error.message).toBe(
      '링크가 만료되었거나 이미 사용되었습니다. 관리자에게 새 링크를 요청하세요.',
    );
  }
  const fresh = await createPasswordReset(ctx, user.id);
  await db.update(users).set({ status: 'DISABLED' }).where(eq(users.id, user.id));
  await expect(resetPassword(db, randomUUID(), tokenOf(fresh), newPassword)).rejects.toMatchObject({
    status: 404,
  });
});
it('동시 재설정은 한 번만 성공, 모든 세션 폐기·계정 잠금 해제·새 암호 로그인·감사', async () => {
  const { db, f, user, ctx } = await fixture();
  const other = await f.session(user.id);
  const ip = randomUUID();
  for (let i = 0; i < 5; i++)
    await expect(
      login(db, randomUUID(), { login_id: user.login_id, password: 'wrong' }, ip),
    ).rejects.toThrow();
  const link = await createPasswordReset(ctx, user.id);
  const results = await Promise.allSettled([
    resetPassword(db, randomUUID(), tokenOf(link), newPassword),
    resetPassword(db, randomUUID(), tokenOf(link), newPassword),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(
    (await db.select().from(sessions).where(eq(sessions.user_id, user.id))).every(
      (session) => session.revoked_at,
    ),
  ).toBe(true);
  await expect(
    authenticate(
      db,
      new Request('http://localhost', { headers: { cookie: `sid=${other.token}` } }),
      randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 401 });
  expect(
    (
      await database().pool.query('SELECT failures, locked_until FROM login_throttles WHERE key=$1', [
        loginThrottleKey('ACCOUNT', user.login_id),
      ])
    ).rows[0],
  ).toEqual({ failures: 0, locked_until: null });
  await expect(
    login(db, randomUUID(), { login_id: user.login_id, password: newPassword.password }, ip),
  ).resolves.toHaveProperty('token');
  await expect(
    login(db, randomUUID(), { login_id: user.login_id, password: 'password1234' }, ip),
  ).rejects.toMatchObject({ status: 401 });
  expect(await getPasswordResetStatus(db, tokenOf(link))).toMatchObject({ status: 'INVALID' });
  const audits = await db.select().from(auditLogs).where(eq(auditLogs.entity_id, link.id));
  expect(audits.map((row) => row.action)).toEqual(['CREATE_PASSWORD_RESET', 'RESET_PASSWORD']);
  expect(JSON.stringify(audits)).not.toContain(newPassword.password);
});
it('모든 역할의 본인 변경: 현재 암호 검증, 본 세션 유지, 다른 세션·재설정 링크 폐기', async () => {
  for (const role of ['ADMIN', 'SITE_MANAGER', 'SETTLEMENT_MANAGER', 'DRIVER'] as const) {
    const { db, f, user, session, ctx } = await fixture(role);
    const other = await f.session(user.id);
    const admin = await f.user();
    const link = await createPasswordReset(f.context(admin), user.id);
    await expect(changePassword(ctx, { ...newPassword, current_password: 'wrong' })).rejects.toMatchObject({
      status: 422,
    });
    await changePassword(ctx, { ...newPassword, current_password: 'password1234' });
    const rows = await db.select().from(sessions).where(eq(sessions.user_id, user.id));
    expect(rows.find((row) => row.id === session.session.id)?.revoked_at).toBeNull();
    expect(rows.find((row) => row.id === other.session.id)?.revoked_at).not.toBeNull();
    expect(await getPasswordResetStatus(db, tokenOf(link))).toMatchObject({ status: 'INVALID' });
    await expect(
      changePassword(
        { ...ctx, session_id: other.session.id },
        { ...newPassword, current_password: newPassword.password },
      ),
    ).rejects.toMatchObject({ status: 401 });
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.entity_id, user.id));
    expect(audits.map((row) => row.action)).toEqual(['CHANGE_PASSWORD_FAILED', 'CHANGE_PASSWORD']);
  }
});
it('현재 암호 동시 실패 횟수는 세션·멱등 키를 바꿔도 유지, 5회부터 잠금, 만료 후 변경', async () => {
  const { db, f, user, session } = await fixture();
  const other = await f.session(user.id);
  const results = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      callRoute(db, changeRoute, {
        method: 'POST',
        token: i % 2 ? session.token : other.token,
        headers: { 'idempotency-key': randomUUID() },
        body: { ...newPassword, current_password: 'wrong' },
      }),
    ),
  );
  expect(results.filter((response) => response.status === 422)).toHaveLength(4);
  expect(results.filter((response) => response.status === 429)).toHaveLength(2);
  const options = {
    method: 'POST',
    token: session.token,
    body: { ...newPassword, current_password: 'password1234' },
  };
  expect((await callRoute(db, changeRoute, options)).status).toBe(429);
  await database().pool.query(
    "UPDATE login_throttles SET locked_until=now()-interval '1 second', window_started_at=now()-interval '20 minutes'",
  );
  expect((await callRoute(db, changeRoute, options)).status).toBe(200);
});
it('비밀번호 확인 불일치·짧은 암호·72바이트 초과는 서버에서 거부', async () => {
  const { db, user, ctx } = await fixture();
  const link = await createPasswordReset(ctx, user.id);
  for (const body of [
    { ...newPassword, password_confirmation: 'different' },
    { password: 'short', password_confirmation: 'short' },
    { password: '가'.repeat(25), password_confirmation: '가'.repeat(25) },
  ]) {
    expect(
      (await callRoute(db, resetRoute, { method: 'POST', params: { token: tokenOf(link) }, body })).status,
    ).toBe(422);
  }
  expect(
    resetPasswordSchema.safeParse({ password: '가'.repeat(24), password_confirmation: '가'.repeat(24) })
      .success,
  ).toBe(true);
  expect(await getPasswordResetStatus(db, tokenOf(link))).toMatchObject({ status: 'VALID' });
});
