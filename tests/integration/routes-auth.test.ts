import { expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { callRoute } from '../helpers/routes';
import { POST as createRoute } from '../../src/app/api/uses/route';
import { PATCH as updateRoute } from '../../src/app/api/uses/[id]/route';
import { POST as loginRoute } from '../../src/app/api/auth/login/route';
import { POST as logoutRoute } from '../../src/app/api/auth/logout/route';
import { GET as meRoute } from '../../src/app/api/me/route';
import { createInvite, acceptInvite, revokeInvite } from '../../src/server/services/auth';
import {
  invites,
  users,
  projectAssignments,
  statements,
  statementItems,
  paymentRecords,
} from '../../src/server/db/schema';
import { createUse } from '../../src/server/services/uses';
import { nextStatementNo } from '../../src/server/db/numbers';
const database = testDatabase();
it('(d) 동시 Idempotency-Key 생성 2회는 같은 응답과 한 건, 요청 불일치 422', async () => {
  const s = await setupScenario(database().db);
  const { token } = await s.f.session(s.driverUser.id);
  const options = {
    token,
    method: 'POST',
    path: '/api/uses',
    body: s.input,
    headers: { 'idempotency-key': crypto.randomUUID() },
  };
  const [a, b] = await Promise.all([
    callRoute(database().db, createRoute, options),
    callRoute(database().db, createRoute, options),
  ]);
  expect(a.status).toBe(200);
  expect(b.status).toBe(200);
  expect(await a.json()).toEqual(await b.json());
  expect(a.headers.get('x-request-id')).toBeTruthy();
  expect([a, b].some((r) => r.headers.get('idempotency-replayed') === 'true')).toBe(true);
  const c = await callRoute(database().db, createRoute, {
    ...options,
    body: { ...s.input, notes: '다른 요청' },
  });
  expect(c.status).toBe(422);
  expect((await c.json()).error.code).toBe('IDEMPOTENCY_MISMATCH');
});
it('Route Handler version 충돌은 409, 잘못된 uuid와 필드는 422', async () => {
  const s = await setupScenario(database().db);
  const use = await createUse(s.adminCtx, s.input);
  const { token } = await s.f.session(s.admin.id);
  const options = {
    token,
    method: 'PATCH',
    params: { id: use.id },
    body: { version: use.version, notes: '변경' },
  };
  expect((await callRoute(database().db, updateRoute, options)).status).toBe(200);
  const c = await callRoute(database().db, updateRoute, options);
  expect(c.status).toBe(409);
  expect((await c.json()).error).toMatchObject({ code: 'VERSION_CONFLICT', details: { current_version: 2 } });
  expect((await callRoute(database().db, updateRoute, { ...options, params: { id: 'bad' } })).status).toBe(
    422,
  );
  expect(
    (
      await callRoute(database().db, createRoute, {
        token,
        method: 'POST',
        body: { ...s.input, approved_amount: 1 },
      })
    ).status,
  ).toBe(422);
});
it('로그인 쿠키·me·로그아웃과 잘못된 비밀번호', async () => {
  const s = await setupScenario(database().db);
  const bad = await callRoute(database().db, loginRoute, {
    method: 'POST',
    body: { login_id: s.admin.login_id, password: 'wrong' },
  });
  expect(bad.status).toBe(401);
  const r = await callRoute(database().db, loginRoute, {
    method: 'POST',
    body: { login_id: s.admin.login_id, password: 'password1234' },
  });
  expect(r.status).toBe(200);
  expect(r.headers.get('set-cookie')).toContain('HttpOnly');
  expect(r.headers.get('set-cookie')).toContain('SameSite=Lax');
  const token = r.headers.get('set-cookie')!.split(';')[0].slice(4);
  const me = await callRoute(database().db, meRoute, { token });
  expect((await me.json()).data.password_hash).toBeUndefined();
  expect((await callRoute(database().db, logoutRoute, { token, method: 'POST' })).status).toBe(200);
  expect((await callRoute(database().db, meRoute, { token })).status).toBe(401);
});
it('초대 1회 수락·만료·회수 및 현장 배정', async () => {
  const s = await setupScenario(database().db);
  const invite = await createInvite(s.adminCtx, {
    role: 'SITE_MANAGER',
    name: '새 담당자',
    project_ids: [s.project.id],
  });
  const token = invite.invite_url.split('/').at(-1)!;
  const loginId = crypto.randomUUID();
  const accepted = await acceptInvite(database().db, crypto.randomUUID(), token, {
    login_id: loginId,
    password: 'password1234',
  });
  expect(accepted.user.role).toBe('SITE_MANAGER');
  const assignment = await database()
    .db.select()
    .from(projectAssignments)
    .where(eq(projectAssignments.user_id, accepted.user.id));
  expect(assignment[0].project_id).toBe(s.project.id);
  await expect(
    acceptInvite(database().db, crypto.randomUUID(), token, {
      login_id: crypto.randomUUID(),
      password: 'password1234',
    }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  const second = await createInvite(s.adminCtx, { role: 'ADMIN', name: '취소 대상' });
  await revokeInvite(s.adminCtx, second.id);
  await expect(
    acceptInvite(database().db, crypto.randomUUID(), second.invite_url.split('/').at(-1)!, {
      login_id: crypto.randomUUID(),
      password: 'password1234',
    }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  const expired = await createInvite(s.adminCtx, { role: 'ADMIN', name: '만료 대상' });
  await database()
    .db.update(invites)
    .set({ expires_at: new Date(0) })
    .where(eq(invites.id, expired.id));
  await expect(
    acceptInvite(database().db, crypto.randomUUID(), expired.invite_url.split('/').at(-1)!, {
      login_id: crypto.randomUUID(),
      password: 'password1234',
    }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(createInvite(s.driverCtx, { role: 'ADMIN', name: '권한 상승' })).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
});
it('부분 유니크: 동일 비용 유효 잠금 하나, 유효 지급 하나; 취소 이력 보존', async () => {
  const s = await setupScenario(database().db);
  const use = await createUse(s.adminCtx, s.input);
  const makeStatement = async () =>
    (
      await database()
        .db.insert(statements)
        .values({
          direction: 'PAYABLE',
          counterparty_id: s.payee.id,
          period_start: '2026-09-01',
          period_end: '2026-09-30',
          created_by: s.admin.id,
        })
        .returning()
    )[0];
  const a = await makeStatement();
  const b = await makeStatement();
  const [item] = await database()
    .db.insert(statementItems)
    .values({ statement_id: a.id, charge_line_id: use.charge_lines[0].id, is_active_lock: true })
    .returning();
  await expect(
    database()
      .db.insert(statementItems)
      .values({ statement_id: b.id, charge_line_id: use.charge_lines[0].id, is_active_lock: true }),
  ).rejects.toThrow();
  await database()
    .db.update(statementItems)
    .set({ is_active_lock: false })
    .where(eq(statementItems.id, item.id));
  await database()
    .db.insert(statementItems)
    .values({ statement_id: b.id, charge_line_id: use.charge_lines[0].id, is_active_lock: true });
  const values = {
    statement_id: b.id,
    kind: 'PAYMENT' as const,
    amount: 330000,
    paid_on: '2026-09-30',
    method: '계좌이체',
    recorded_by: s.admin.id,
  };
  const [payment] = await database().db.insert(paymentRecords).values(values).returning();
  await expect(database().db.insert(paymentRecords).values(values)).rejects.toThrow();
  await database()
    .db.update(paymentRecords)
    .set({ voided_at: new Date(), voided_by: s.admin.id, void_reason: '오입력' })
    .where(eq(paymentRecords.id, payment.id));
  await database().db.insert(paymentRecords).values(values);
  const nums = await Promise.all(
    Array.from({ length: 10 }, () => nextStatementNo(database().db, 'PAYABLE', '2026-09-01')),
  );
  expect(new Set(nums).size).toBe(10);
  expect(nums[0]).toMatch(/^PAY-202609-\d{4,}$/);
});
it('세션 토큰은 DB에 평문 저장되지 않음, 외부 출처 변경 요청 차단', async () => {
  const s = await setupScenario(database().db);
  const { token } = await s.f.session(s.admin.id);
  const row = await database().db.execute(sql`SELECT token_hash FROM sessions WHERE user_id=${s.admin.id}`);
  expect(row.rows[0].token_hash).not.toBe(token);
  const r = await callRoute(database().db, createRoute, {
    token,
    method: 'POST',
    body: s.input,
    headers: { origin: 'https://evil.example' },
  });
  expect(r.status).toBe(403);
  await database().db.update(users).set({ status: 'DISABLED' }).where(eq(users.id, s.admin.id));
  await expect(createUse(s.adminCtx, s.input)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
});
