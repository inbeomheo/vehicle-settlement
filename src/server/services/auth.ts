import { resolveJoinBusiness, joinBusinessSummary } from './join-business';
import { lockLoginCounters, recordLoginFailure } from '../auth/login-throttle';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import {
  invites,
  projects,
  projectAssignments,
  sessions,
  pushSubscriptions,
  users,
  drivers,
  auditLogs,
  loginThrottles,
} from '../db/schema';
import type { Db } from '../db/client';
import type { Context } from '../context';
import { todaySeoul } from '../context';
import { assertAdmin, assertActive, redactForDriver } from '../authz';
import { AppError, invalid, notFound } from '../errors';
import { audit } from '../audit';
import { hashPassword, hashToken, newToken, verifyPassword } from '../auth/password';
import { createSession, publicUser } from '../auth/session';
import { acceptInviteSchema, inviteSchema, loginSchema } from './schemas';
import { atomic } from './uses';
import { adminTransaction } from './admin';
import { lockDriverIdentity } from './driver-identity';
import { activeInvitationProjectIds } from './invitation-projects';
const dummyHash = '$2b$12$xfIAqj/l75DvApKa/BibPuP9PIutJEQowUAsFjkOrNldWxguz5ynK';
export async function login(db: Db, requestId: string, raw: z.input<typeof loginSchema>, ip = 'unavailable') {
  const input = loginSchema.parse(raw);
  // Return failures instead of throwing inside the transaction: failed attempts
  // and shared row locks must commit even though no session is created.
  const outcome = await db.transaction(async (tx) => {
    const state = await lockLoginCounters(tx, input.login_id, ip);
    const locked = state.counters.some((counter) => counter.locked_until && counter.locked_until > state.now);
    const [user] = await tx.select().from(users).where(eq(users.login_id, input.login_id)).for('update');
    const valid = await verifyPassword(input.password, user?.password_hash ?? dummyHash);
    if (locked || !user || !valid || user.status !== 'ACTIVE') {
      const throttled = locked || (await recordLoginFailure(tx, state));
      return {
        failure: { user_id: user?.id ?? null, throttled, keys: state.counters.map((counter) => counter.key) },
      };
    }
    const result = await createSession(tx, user.id);
    const ctx = { db: tx, user, request_id: requestId };
    await audit(ctx, 'LOGIN', 'session', result.session.id);
    await tx
      .update(loginThrottles)
      .set({
        failures: 0,
        locked_until: null,
        window_started_at: state.now,
        updated_at: state.now,
      })
      .where(
        inArray(
          loginThrottles.id,
          state.counters.filter((counter) => counter.scope === 'ACCOUNT').map((counter) => counter.id),
        ),
      );
    return { success: { token: result.token, user: redactForDriver(ctx, publicUser(user)) } };
  });
  if (outcome.failure) {
    // Deliberately outside the login transaction; never store passwords or raw
    // credentials/IPs, including for unknown accounts and locked attempts.
    await db.insert(auditLogs).values({
      user_id: outcome.failure.user_id,
      action: 'LOGIN_FAILED',
      entity_type: 'session',
      request_id: requestId,
      after: { throttle_keys: outcome.failure.keys },
      reason: outcome.failure.throttled ? '로그인 시도 제한' : '인증 실패',
    });
    throw outcome.failure.throttled
      ? new AppError(
          'LOGIN_THROTTLED',
          '로그인 시도가 너무 많습니다. 15분 후 다시 시도하거나 관리자에게 문의하세요.',
        )
      : new AppError('UNAUTHENTICATED', '아이디 또는 비밀번호를 확인하세요.');
  }
  return outcome.success!;
}
export async function logout(ctx: Context) {
  return atomic(ctx, async (tx) => {
    if (ctx.session_id) {
      await tx.db
        .update(sessions)
        .set({ revoked_at: new Date(), updated_at: new Date() })
        .where(eq(sessions.id, ctx.session_id));
      await tx.db.delete(pushSubscriptions).where(eq(pushSubscriptions.session_id, ctx.session_id));
      await audit(tx, 'LOGOUT', 'session', ctx.session_id);
    }
    return { logged_out: true };
  });
}
export async function listInvites(ctx: Context) {
  await assertActive(ctx);
  assertAdmin(ctx);
  const rows = await ctx.db.select().from(invites);
  return rows.map(({ token_hash: _hash, ...rest }) => {
    void _hash;
    return rest;
  });
}
export async function getInviteStatus(db: Db, token: string) {
  const [invite] = await db
    .select({
      name: invites.name,
      role: invites.role,
      driver_id: invites.driver_id,
      counterparty_id: invites.counterparty_id,
      used_at: invites.used_at,
      revoked_at: invites.revoked_at,
      expires_at: invites.expires_at,
    })
    .from(invites)
    .where(eq(invites.token_hash, hashToken(token)));
  if (!invite || invite.used_at || invite.revoked_at || invite.expires_at <= new Date())
    return { status: 'INVALID' as const, name: null, role: null };
  const business = await joinBusinessSummary(db, invite.counterparty_id);
  if (invite.counterparty_id && !business) return { status: 'INVALID' as const, name: null, role: null };
  return {
    ...(business ? { business } : {}),
    status: 'VALID' as const,
    name: invite.name,
    role: invite.role,
    ...(invite.role === 'DRIVER' && !invite.driver_id ? { needs_profile: true } : {}),
  };
}
export async function createInvite(ctx: Context, raw: z.input<typeof inviteSchema>) {
  const input = inviteSchema.parse(raw);
  return adminTransaction(ctx, async (tx) => {
    assertAdmin(tx);

    if (input.driver_id) {
      const [driver] = await tx.db
        .select()
        .from(drivers)
        .where(and(eq(drivers.id, input.driver_id), eq(drivers.active, true)))
        .for('update');
      if (!driver) notFound();
      const [account] = await tx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.driver_id, driver.id));
      if (account) invalid('이미 계정이 연결된 기사입니다. 계정 없는 기사를 선택하세요.');
    }
    if (input.project_ids.length) {
      const found = await tx.db
        .select()
        .from(projects)
        .where(and(inArray(projects.id, input.project_ids), eq(projects.active, true)));
      if (found.length !== new Set(input.project_ids).size) notFound();
    }
    const counterpartyId = await resolveJoinBusiness(tx, input);
    const { new_business: _business, ...inviteInput } = input;
    void _business;
    const token = newToken();
    const [row] = await tx.db
      .insert(invites)
      .values({
        ...inviteInput,
        counterparty_id: counterpartyId,
        project_ids: [...new Set(input.project_ids)],
        token_hash: hashToken(token),
        expires_at: new Date(Date.now() + 7 * 86400000),
        created_by: tx.user.id,
      })
      .returning();
    const { token_hash: _hash, ...out } = row;
    void _hash;
    await audit(tx, 'INVITE', 'invite', row.id, null, out);
    return { ...out, invite_url: `${process.env.APP_URL ?? 'http://localhost:3000'}/invite/${token}` };
  });
}
export async function revokeInvite(ctx: Context, id: string) {
  return atomic(ctx, async (tx) => {
    assertAdmin(tx);
    const [before] = await tx.db.select().from(invites).where(eq(invites.id, id)).for('update');
    if (!before) notFound();
    if (before.used_at) invalid('이미 수락된 초대입니다.');
    const [after] = await tx.db
      .update(invites)
      .set({ revoked_at: new Date(), updated_at: new Date() })
      .where(eq(invites.id, id))
      .returning();
    await audit(
      tx,
      'REVOKE_INVITE',
      'invite',
      id,
      { revoked_at: before.revoked_at },
      { revoked_at: after.revoked_at },
    );
    return { id, revoked_at: after.revoked_at };
  });
}
export async function acceptInvite(
  db: Db,
  requestId: string,
  token: string,
  raw: z.input<typeof acceptInviteSchema>,
) {
  const input = acceptInviteSchema.parse(raw);
  return db.transaction(async (tx) => {
    await lockDriverIdentity(tx);
    const [invite] = await tx
      .select()
      .from(invites)
      .where(eq(invites.token_hash, hashToken(token)))
      .for('update');
    if (!invite || invite.used_at || invite.revoked_at || invite.expires_at <= new Date()) notFound();
    if (invite.role === 'DRIVER' && !invite.driver_id)
      invalid('기사 가입 화면에서 사업자·차량 정보를 입력하세요.');
    if (invite.driver_id) {
      const [driver] = await tx.select().from(drivers).where(eq(drivers.id, invite.driver_id)).for('update');
      if (!driver?.active) invalid('초대된 기사가 사용 중지되었습니다. 관리자에게 문의하세요.');
      const [account] = await tx.select({ id: users.id }).from(users).where(eq(users.driver_id, driver.id));
      if (account) invalid('이미 계정이 연결된 기사입니다. 관리자에게 문의하세요.');
    }
    const projectIds =
      invite.role === 'DRIVER'
        ? await activeInvitationProjectIds(tx, invite.project_ids)
        : invite.project_ids;
    const [existing] = await tx.select().from(users).where(eq(users.login_id, input.login_id));
    if (existing) invalid('이미 사용 중인 아이디입니다.');
    const [user] = await tx
      .insert(users)
      .values({
        login_id: input.login_id,
        password_hash: await hashPassword(input.password),
        name: invite.name,
        phone: invite.phone,
        role: invite.role,
        driver_id: invite.driver_id,
      })
      .returning();
    if (projectIds.length)
      await tx.insert(projectAssignments).values(
        projectIds.map((project_id) => ({
          user_id: user.id,
          project_id,
          valid_from: todaySeoul(),
        })),
      );
    await tx
      .update(invites)
      .set({ used_at: new Date(), used_by_user_id: user.id, updated_at: new Date() })
      .where(and(eq(invites.id, invite.id), isNull(invites.used_at)));
    const result = await createSession(tx, user.id);
    const ctx = { db: tx, user, request_id: requestId };
    await audit(ctx, 'ACCEPT_INVITE', 'invite', invite.id, null, {
      user_id: user.id,
      project_ids: projectIds,
    });
    return { token: result.token, user: redactForDriver(ctx, publicUser(user)) };
  });
}
