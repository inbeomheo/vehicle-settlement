import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { GET as inviteStatusRoute } from '../../src/app/api/invites/[id]/route';
import { hashToken } from '../../src/server/auth/password';
import { invites, users } from '../../src/server/db/schema';
import { acceptInvite, createInvite, getInviteStatus, revokeInvite } from '../../src/server/services/auth';
import { queryAudit } from '../../src/server/services/audit-query';
import { createUse } from '../../src/server/services/uses';
import { recordPayment, voidPayment } from '../../src/server/services/payments';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { callRoute } from '../helpers/routes';
import { approved, confirmed, scenario } from './W4-fixtures';

const database = testDatabase();
const invitationToken = (invite: { invite_url: string }) => invite.invite_url.split('/').at(-1)!;

it('3. 공개 초대 조회는 토큰 해시로 조회하며 상태·이름·역할만 반환한다', async () => {
  const s = await setupScenario(database().db);
  const invite = await createInvite(s.adminCtx, {
    role: 'SITE_MANAGER',
    name: '새 현장 담당자',
    phone: '010-1234-5678',
    project_ids: [s.project.id],
  });
  const token = invitationToken(invite);
  const response = await callRoute(database().db, inviteStatusRoute, { params: { id: token } });
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect((await response.json()).data).toEqual({
    status: 'VALID',
    name: '새 현장 담당자',
    role: 'SITE_MANAGER',
  });
  const [stored] = await database().db.select().from(invites).where(eq(invites.id, invite.id));
  expect(stored.token_hash).toBe(hashToken(token));
  expect(await getInviteStatus(database().db, invite.id)).toEqual({
    status: 'INVALID',
    name: null,
    role: null,
  });
  expect(await getInviteStatus(database().db, 'unknown')).toEqual({
    status: 'INVALID',
    name: null,
    role: null,
  });
});

it('3. 사용·만료·취소된 초대는 이름·역할을 숨기고 즉시 무효 상태를 반환한다', async () => {
  const s = await setupScenario(database().db);
  for (const state of ['used', 'expired', 'revoked']) {
    const invite = await createInvite(s.adminCtx, { role: 'SITE_MANAGER', name: `초대 ${state}` });
    const token = invitationToken(invite);
    if (state === 'used')
      await acceptInvite(database().db, randomUUID(), token, {
        login_id: randomUUID(),
        password: 'password1234',
      });
    if (state === 'expired')
      await database()
        .db.update(invites)
        .set({ expires_at: new Date(0) })
        .where(eq(invites.id, invite.id));
    if (state === 'revoked') await revokeInvite(s.adminCtx, invite.id);
    const response = await callRoute(database().db, inviteStatusRoute, { params: { id: token } });
    expect((await response.json()).data).toEqual({ status: 'INVALID', name: null, role: null });
  }
});

it('10. 계정 있는 기사 초대를 서버에서 거부하고 동시에 수락해도 기사 계정은 한 개만 만든다', async () => {
  const s = await setupScenario(database().db);
  await expect(
    createInvite(s.adminCtx, { role: 'DRIVER', name: '중복 기사', driver_id: s.driver.id }),
  ).rejects.toThrow('이미 계정이 연결된 기사');
  const driver = await s.f.driver({ name: '새 기사' });
  const first = await createInvite(s.adminCtx, { role: 'DRIVER', name: driver.name, driver_id: driver.id });
  const second = await createInvite(s.adminCtx, { role: 'DRIVER', name: driver.name, driver_id: driver.id });
  const results = await Promise.allSettled(
    [first, second].map((invite) =>
      acceptInvite(database().db, randomUUID(), invitationToken(invite), {
        login_id: randomUUID(),
        password: 'password1234',
      }),
    ),
  );
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(await database().db.select().from(users).where(eq(users.driver_id, driver.id))).toHaveLength(1);
});

it('9. 사용번호 검색·사용자 선택에도 현장 권한 및 비밀정보 제거를 유지한다', async () => {
  const s = await setupScenario(database().db);
  const allowed = await createUse(s.adminCtx, s.input);
  const outside = await setupScenario(database().db);
  const hidden = await createUse(outside.adminCtx, outside.input);
  const manager = await s.f.user({ role: 'SITE_MANAGER' });
  await s.f.assignment(manager.id, s.project.id);
  const ctx = s.f.context(manager);
  const found = await queryAudit(ctx, { search: allowed.use_no, user_id: s.admin.id });
  expect(found.total).toBe(1);
  expect(found.rows).toEqual([expect.objectContaining({ entity_no: allowed.use_no, user_id: s.admin.id })]);
  expect(found.user_options).toEqual([{ id: s.admin.id, name: s.admin.name }]);
  expect((await queryAudit(ctx, { search: hidden.use_no })).total).toBe(0);
  expect((await queryAudit(ctx, { user_id: outside.admin.id })).total).toBe(0);
  await expect(queryAudit(s.driverCtx, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

it('9. 명세번호로 명세 확정과 연결된 지급 취소 이력을 찾는다', async () => {
  const s = await scenario(database().db);
  const use = await approved(s);
  const statement = await confirmed(
    s,
    use.charge_lines.map((line) => line.id),
  );
  const payment = await recordPayment(s.adminCtx, statement.id, {
    client_request_id: randomUUID(),
    kind: 'PAYMENT',
    amount: statement.grand_total,
    paid_on: '2026-09-29',
    method: '계좌이체',
  });
  await voidPayment(s.adminCtx, payment.id, { reason: '잘못 기록함' });
  const result = await queryAudit(s.adminCtx, { search: statement.statement_no!.toLowerCase() });
  expect(result.rows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ action: 'STATEMENT_CONFIRM', entity_no: statement.statement_no }),
      expect.objectContaining({ action: 'PAYMENT_VOID', entity_no: statement.statement_no }),
    ]),
  );
  const filtered = await queryAudit(s.adminCtx, { search: statement.statement_no, entity_type: 'payment' });
  expect(filtered.total).toBe(2);
});
