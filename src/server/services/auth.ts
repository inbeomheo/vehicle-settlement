import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { invites, projects, projectAssignments, sessions, users, drivers } from '../db/schema';
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
const dummyHash = '$2b$12$xfIAqj/l75DvApKa/BibPuP9PIutJEQowUAsFjkOrNldWxguz5ynK';
export async function login(db: Db, requestId: string, raw: z.input<typeof loginSchema>) {
  const input = loginSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.login_id, input.login_id)).for('update');
    const valid = await verifyPassword(input.password, user?.password_hash ?? dummyHash);
    if (!user || !valid || user.status !== 'ACTIVE')
      throw new AppError('UNAUTHENTICATED', '아이디 또는 비밀번호를 확인하세요.');
    const result = await createSession(tx, user.id);
    const ctx = { db: tx, user, request_id: requestId };
    await audit(ctx, 'LOGIN', 'session', result.session.id);
    return { token: result.token, user: redactForDriver(ctx, publicUser(user)) };
  });
}
export async function logout(ctx: Context) {
  return atomic(ctx, async (tx) => {
    if (ctx.session_id) {
      await tx.db
        .update(sessions)
        .set({ revoked_at: new Date(), updated_at: new Date() })
        .where(eq(sessions.id, ctx.session_id));
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
export async function createInvite(ctx: Context, raw: z.input<typeof inviteSchema>) {
  const input = inviteSchema.parse(raw);
  return atomic(ctx, async (tx) => {
    assertAdmin(tx);
    if (input.role === 'DRIVER' && !input.driver_id) invalid('기사 연결이 필요합니다.');
    if (input.driver_id) {
      const [driver] = await tx.db
        .select()
        .from(drivers)
        .where(and(eq(drivers.id, input.driver_id), eq(drivers.active, true)));
      if (!driver) notFound();
    }
    if (input.project_ids.length) {
      const found = await tx.db
        .select()
        .from(projects)
        .where(and(inArray(projects.id, input.project_ids), eq(projects.active, true)));
      if (found.length !== new Set(input.project_ids).size) notFound();
    }
    const token = newToken();
    const [row] = await tx.db
      .insert(invites)
      .values({
        ...input,
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
    const [invite] = await tx
      .select()
      .from(invites)
      .where(eq(invites.token_hash, hashToken(token)))
      .for('update');
    if (!invite || invite.used_at || invite.revoked_at || invite.expires_at <= new Date()) notFound();
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
    if (invite.project_ids.length)
      await tx.insert(projectAssignments).values(
        invite.project_ids.map((project_id) => ({
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
      project_ids: invite.project_ids,
    });
    return { token: result.token, user: redactForDriver(ctx, publicUser(user)) };
  });
}
