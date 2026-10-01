import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Context } from '../context';
import { todaySeoul } from '../context';
import type { Db } from '../db/client';
import {
  driverJoinLinks,
  driverRegistrations,
  invites,
  projectAssignments,
  projects,
  users,
} from '../db/schema';
import { assertActive, assertAdmin } from '../authz';
import { hashPassword, hashToken, newToken, passwordWithinByteLimit, verifyPassword } from '../auth/password';
import { createSession, publicUser } from '../auth/session';
import { audit } from '../audit';
import { AppError, invalid, notFound } from '../errors';
import { adminTransaction } from './admin';
import { driverInformationSchema, joinLinkSchema } from './driver-schemas';
import { lockDriverIdentity, saveDriverIdentity } from './driver-identity';

export const registerDriverSchema = z
  .object({
    client_request_id: z.string().uuid(),
    login_id: z.string().trim().min(1).max(100),
    password: z.string().min(8).refine(passwordWithinByteLimit, '비밀번호가 너무 깁니다'),
    profile: driverInformationSchema,
  })
  .strict();

async function activeProjects(db: Db, ids: string[]) {
  const rows = ids.length
    ? await db
        .select()
        .from(projects)
        .where(and(inArray(projects.id, ids), eq(projects.active, true)))
        .for('key share')
    : [];
  if (rows.length !== new Set(ids).size)
    invalid('가입 현장이 사용 중지되었거나 삭제되었습니다. 관리자에게 새 링크를 요청하세요.');
  return rows;
}
export async function createJoinLink(ctx: Context, raw: unknown) {
  const input = joinLinkSchema.parse(raw);
  return adminTransaction(ctx, async (tx) => {
    await assertActive(tx);
    assertAdmin(tx);
    await activeProjects(tx.db, input.project_ids);
    const token = newToken();
    const [row] = await tx.db
      .insert(driverJoinLinks)
      .values({
        token_hash: hashToken(token),
        project_ids: input.project_ids,
        expires_at: new Date(Date.now() + input.expires_in_days * 86400000),
        created_by: tx.user.id,
      })
      .returning();
    const { token_hash: _hash, ...out } = row;
    void _hash;
    await audit(tx, 'CREATE_JOIN_LINK', 'driver_join_link', row.id, null, out);
    return { ...out, join_url: `${process.env.APP_URL ?? 'http://localhost:3000'}/join/${token}` };
  });
}
export async function listJoinLinks(ctx: Context) {
  await assertActive(ctx);
  assertAdmin(ctx);
  return (
    await ctx.db.execute(sql`SELECT l.id, l.project_ids, l.expires_at, l.revoked_at, l.created_at, l.version,
    (SELECT count(*)::int FROM driver_registrations r WHERE r.link_id=l.id) AS used_count,
    (SELECT coalesce(jsonb_agg(p.name ORDER BY p.name), '[]') FROM projects p WHERE l.project_ids ? p.id::text) AS project_names
    FROM driver_join_links l ORDER BY l.created_at DESC, l.id`)
  ).rows;
}
export async function revokeJoinLink(ctx: Context, id: string, raw: unknown) {
  z.string().uuid().parse(id);
  const { version } = z.object({ version: z.number().int().positive() }).strict().parse(raw);
  return adminTransaction(ctx, async (tx) => {
    await assertActive(tx);
    assertAdmin(tx);
    const [before] = await tx.db
      .select()
      .from(driverJoinLinks)
      .where(eq(driverJoinLinks.id, id))
      .for('update');
    if (!before) notFound();
    if (version !== before.version)
      throw new AppError('VERSION_CONFLICT', '링크가 변경되었습니다. 목록을 새로고침하세요.');
    await tx.db
      .update(driverJoinLinks)
      .set({ revoked_at: new Date(), updated_at: new Date(), version: version + 1 })
      .where(eq(driverJoinLinks.id, id));
    await audit(
      tx,
      'REVOKE_JOIN_LINK',
      'driver_join_link',
      id,
      { revoked_at: before.revoked_at },
      { revoked_at: new Date() },
    );
    return { id, revoked: true };
  });
}
export async function getJoinLinkStatus(db: Db, token: string) {
  const [row] = await db
    .select()
    .from(driverJoinLinks)
    .where(eq(driverJoinLinks.token_hash, hashToken(token)));
  if (!row || row.revoked_at || row.expires_at <= new Date()) return null;
  const assigned = row.project_ids.length
    ? await db
        .select({ name: projects.name, active: projects.active })
        .from(projects)
        .where(inArray(projects.id, row.project_ids))
    : [];
  if (assigned.length !== row.project_ids.length || assigned.some((p) => !p.active)) return null;
  return { project_names: assigned.map((p) => p.name) };
}
export async function registerDriver(
  db: Db,
  requestId: string,
  token: string,
  raw: unknown,
  individual = false,
) {
  const input = registerDriverSchema.parse(raw);
  // Include the high-entropy token in the digest. Neither credentials nor the
  // original token are persisted in registrations, audit logs or responses.
  const requestHash = hashToken(`${token}\n${JSON.stringify(input)}`);
  return db.transaction(async (tx) => {
    await lockDriverIdentity(tx);
    const [source] = individual
      ? await tx
          .select()
          .from(invites)
          .where(eq(invites.token_hash, hashToken(token)))
          .for('update')
      : await tx
          .select()
          .from(driverJoinLinks)
          .where(eq(driverJoinLinks.token_hash, hashToken(token)))
          .for('update');
    if (!source || source.revoked_at || source.expires_at <= new Date()) notFound();
    if ('role' in source && (source.role !== 'DRIVER' || source.driver_id)) notFound();
    const [prior] = await tx
      .select()
      .from(driverRegistrations)
      .where(eq(driverRegistrations.client_request_id, input.client_request_id));
    if (prior) {
      if (prior.request_hash !== requestHash || (individual ? prior.invite_id : prior.link_id) !== source.id)
        throw new AppError(
          'IDEMPOTENCY_MISMATCH',
          '같은 가입 요청에 다른 정보를 보낼 수 없습니다. 새로고침 후 다시 가입하세요.',
        );
      const [user] = await tx.select().from(users).where(eq(users.id, prior.user_id));
      if (!user || user.status !== 'ACTIVE' || !(await verifyPassword(input.password, user.password_hash)))
        notFound();
      const session = await createSession(tx, user.id);
      return { user: publicUser(user), token: session.token };
    }
    if ('used_at' in source && source.used_at) notFound();
    await activeProjects(tx, source.project_ids);
    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.login_id, input.login_id));
    if (existing) invalid('이미 사용 중인 아이디입니다. 다른 아이디를 입력하세요.');
    const driver = await saveDriverIdentity(tx, input.profile);
    const [user] = await tx
      .insert(users)
      .values({
        login_id: input.login_id,
        password_hash: await hashPassword(input.password),
        name: driver.name,
        phone: driver.phone,
        role: 'DRIVER',
        driver_id: driver.id,
      })
      .returning();
    if (source.project_ids.length)
      await tx.insert(projectAssignments).values(
        source.project_ids.map((project_id) => ({
          project_id,
          user_id: user.id,
          valid_from: todaySeoul(),
        })),
      );
    await tx.insert(driverRegistrations).values({
      client_request_id: input.client_request_id,
      request_hash: requestHash,
      link_id: individual ? null : source.id,
      invite_id: individual ? source.id : null,
      user_id: user.id,
    });
    if (individual)
      await tx
        .update(invites)
        .set({ used_at: new Date(), used_by_user_id: user.id, updated_at: new Date() })
        .where(eq(invites.id, source.id));
    await audit({ db: tx, user, request_id: requestId }, 'REGISTER_DRIVER', 'user', user.id, null, {
      driver_id: driver.id,
      profile: input.profile,
      project_ids: source.project_ids,
      link_id: individual ? null : source.id,
      invite_id: individual ? source.id : null,
    });
    const session = await createSession(tx, user.id);
    return { user: publicUser(user), token: session.token };
  });
}
