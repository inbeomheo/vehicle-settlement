import { approvedJoinBusiness, resolveJoinBusiness, joinBusinessSummary } from './join-business';
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
import { activeInvitationProjectIds } from './invitation-projects';

export const registerDriverSchema = z
  .object({
    client_request_id: z.string().uuid(),
    login_id: z.string().trim().min(1).max(100),
    password: z.string().min(8).refine(passwordWithinByteLimit, '비밀번호가 너무 깁니다'),
    profile: driverInformationSchema.partial({ business_name: true, biz_no: true }),
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
    const counterpartyId = await resolveJoinBusiness(tx, input);
    const token = newToken();
    const [row] = await tx.db
      .insert(driverJoinLinks)
      .values({
        counterparty_id: counterpartyId,
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
    await ctx.db
      .execute(sql`SELECT l.id, l.counterparty_id, c.name AS business_name, l.project_ids, l.expires_at, l.revoked_at, l.created_at, l.version,
    (SELECT count(*)::int FROM driver_registrations r WHERE r.link_id=l.id) AS used_count,
    (SELECT coalesce(jsonb_agg(p.name ORDER BY p.name), '[]') FROM projects p WHERE l.project_ids ? p.id::text) AS project_names
    FROM driver_join_links l LEFT JOIN counterparties c ON c.id=l.counterparty_id ORDER BY l.created_at DESC, l.id`)
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
        .where(and(inArray(projects.id, row.project_ids), eq(projects.active, true)))
    : [];
  if (!assigned.length) return null;
  const business = await joinBusinessSummary(db, row.counterparty_id);
  if (row.counterparty_id && !business) return null;
  return { project_names: assigned.map((p) => p.name), business };
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
    const party = source.counterparty_id ? await approvedJoinBusiness(tx, source.counterparty_id) : null;
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
      // Serialize password verification/session issuance with password replacement.
      // This path takes no throttle locks; reset/change never take the join lock.
      const [user] = await tx.select().from(users).where(eq(users.id, prior.user_id)).for('update');
      if (!user || user.status !== 'ACTIVE' || !(await verifyPassword(input.password, user.password_hash)))
        notFound();
      const session = await createSession(tx, user.id);
      return { user: publicUser(user), token: session.token };
    }
    if ('used_at' in source && source.used_at) notFound();
    const projectIds = await activeInvitationProjectIds(tx, source.project_ids);
    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.login_id, input.login_id));
    if (existing) invalid('이미 사용 중인 아이디입니다. 다른 아이디를 입력하세요.');
    const linkedVehicle =
      await tx.execute(sql`SELECT 1 FROM drivers d JOIN vehicles v ON v.id=d.default_vehicle_id
      WHERE regexp_replace(upper(v.plate_no), '\\s', '', 'g')=${input.profile.plate_no} LIMIT 1`);
    if (linkedVehicle.rows.length)
      invalid(
        '같은 차량번호가 다른 기사에 연결되어 있습니다. 관리자에게 기사 추가(개별 초대)를 요청해 주세요.',
      );
    if (party && (input.profile.business_name !== undefined || input.profile.biz_no !== undefined))
      invalid('지정된 소속 사업자는 가입 화면에서 변경할 수 없습니다.');
    const profile = party
      ? {
          ...driverInformationSchema.omit({ business_name: true, biz_no: true }).parse(input.profile),
          business_name: party.name,
          biz_no: party.biz_no ?? '',
        }
      : driverInformationSchema.parse(input.profile);
    const driver = await saveDriverIdentity(tx, profile, undefined, false, party?.id);
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
    if (projectIds.length)
      await tx.insert(projectAssignments).values(
        projectIds.map((project_id) => ({
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
      profile,
      counterparty_id: party?.id ?? null,
      project_ids: projectIds,
      link_id: individual ? null : source.id,
      invite_id: individual ? source.id : null,
    });
    const session = await createSession(tx, user.id);
    return { user: publicUser(user), token: session.token };
  });
}
