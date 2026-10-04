import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { todaySeoul, type Context } from '../context';
import { assertActive, assertAdmin, accessibleProjectIds } from '../authz';
import { audit } from '../audit';
import { AppError, invalid, notFound } from '../errors';
import { users, sessions, pushSubscriptions, projectAssignments, drivers, projects } from '../db/schema';
import { publicUser } from '../auth/session';
import { atomic } from './uses';
import {
  masterSchemas,
  type MasterResource,
  userPatchSchema,
  assignmentSchema,
  validateDates,
} from './admin-schemas';
import { uuid } from './schemas';
import { userDeletionFlags } from './user-deletion';

const tableNames: Record<MasterResource, string> = {
  projects: 'projects',
  'work-types': 'work_types',
  counterparties: 'counterparties',
  drivers: 'drivers',
  vehicles: 'vehicles',
  affiliations: 'driver_affiliations',
  company: 'company_settings',
};
export async function managerOnly(ctx: Context) {
  await assertActive(ctx);
  if (ctx.user.role === 'DRIVER') throw new AppError('FORBIDDEN', '담당자 권한이 필요합니다.');
}
export async function adminTransaction<T>(ctx: Context, fn: (tx: Context) => Promise<T>) {
  return atomic(ctx, async (tx) => {
    assertAdmin(tx);
    // All administrative writes share one lock: period checks and last-admin checks are atomic.
    await tx.db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('w3:administration', 0))`);
    // 잠금을 기다리는 동안 권한이 회수됐을 수 있으므로 잠금 뒤 최신 상태로 다시 확인한다.
    const [actor] = await tx.db
      .select({ role: users.role, status: users.status })
      .from(users)
      .where(eq(users.id, tx.user.id));
    if (!actor || actor.role !== 'ADMIN' || actor.status !== 'ACTIVE')
      throw new AppError('FORBIDDEN', '관리자 권한이 필요합니다.');
    return fn(tx);
  });
}
export function masterResource(value: string): MasterResource {
  if (!Object.prototype.hasOwnProperty.call(masterSchemas, value)) notFound();
  return value as MasterResource;
}
export async function listMaster(ctx: Context, resource: MasterResource) {
  await managerOnly(ctx);
  if (ctx.user.role === 'SITE_MANAGER')
    throw new AppError('FORBIDDEN', '관리자 또는 정산 담당자 권한이 필요합니다.');
  if (resource === 'company' || resource === 'affiliations') assertAdmin(ctx);
  const ids = resource === 'projects' ? await accessibleProjectIds(ctx) : null;
  const scope =
    ids === null
      ? sql`true`
      : ids.length
        ? sql`id in (${sql.join(
            ids.map((id) => sql`${id}::uuid`),
            sql`,`,
          )})`
        : sql`false`;
  return (
    await ctx.db.execute(
      sql`SELECT * FROM ${sql.identifier(tableNames[resource])} WHERE ${scope} ORDER BY created_at DESC, id`,
    )
  ).rows;
}
export async function saveMaster(ctx: Context, resource: MasterResource, raw: unknown, id?: string) {
  if (id) uuid.parse(id);
  return adminTransaction(ctx, async (tx) => {
    const table = sql.identifier(tableNames[resource]);
    const before = id
      ? (await tx.db.execute(sql`SELECT * FROM ${table} WHERE id=${id}::uuid FOR UPDATE`)).rows[0]
      : undefined;
    if (id && !before) notFound();
    const schema =
      !id && resource === 'projects'
        ? masterSchemas.projects.extend({ assign_all_drivers: z.boolean().default(false) })
        : id
          ? masterSchemas[resource].partial()
          : masterSchemas[resource];
    const parsed = schema.parse(raw);
    const assignAllDrivers = 'assign_all_drivers' in parsed && parsed.assign_all_drivers;
    if ('assign_all_drivers' in parsed) delete (parsed as Record<string, unknown>).assign_all_drivers;
    // Zod defaults also run inside optional fields; PATCH must only write explicitly supplied keys.
    const input: Record<string, unknown> = id
      ? Object.fromEntries(Object.entries(parsed).filter(([key]) => Object.hasOwn(raw as object, key)))
      : parsed;
    if (resource === 'projects' && (!id || Object.hasOwn(input, 'code')) && !input.code) {
      Object.assign(input, { code: before?.code ?? `P-${randomUUID()}` });
    }
    const merged: Record<string, unknown> = { ...before, ...input };
    const references =
      resource === 'drivers'
        ? [['default_vehicle_id', 'vehicles', '기본차량']]
        : resource === 'affiliations'
          ? [
              ['driver_id', 'drivers', '기사'],
              ['counterparty_id', 'counterparties', '지급처'],
            ]
          : [];
    for (const [key, targetTable, title] of references) {
      if (merged[key] && merged[key] !== before?.[key]) {
        const [target] = (
          await tx.db.execute(
            sql`SELECT active FROM ${sql.identifier(targetTable)} WHERE id=${merged[key]}::uuid`,
          )
        ).rows;
        if (!target?.active) invalid(`사용 중인 ${title}을 선택하세요.`);
      }
    }
    if (resource === 'affiliations') {
      const affiliation = masterSchemas.affiliations.parse(
        mergedFields(merged, masterSchemas.affiliations.shape),
      );
      validateDates(affiliation);
      const conflict = await tx.db
        .execute(sql`SELECT id FROM driver_affiliations WHERE driver_id=${affiliation.driver_id}::uuid
        AND id IS DISTINCT FROM ${id ?? null}::uuid AND valid_from <= COALESCE(${affiliation.valid_to}::date, 'infinity'::date)
        AND COALESCE(valid_to,'infinity'::date) >= ${affiliation.valid_from}::date`);
      if (conflict.rows.length) invalid('기사 소속 기간이 겹칩니다. 기존 종료일을 먼저 확인하세요.');
      const [party] = (
        await tx.db.execute(
          sql`SELECT kind FROM counterparties WHERE id=${affiliation.counterparty_id}::uuid`,
        )
      ).rows;
      if (!party || party.kind === 'CUSTOMER') invalid('소속 지급처는 운송사 또는 기사 사업자여야 합니다.');
    }
    const entries = Object.entries(input).filter(([, value]) => value !== undefined);
    if (!entries.length) invalid('변경할 값을 입력하세요.');
    const [after] = (
      await tx.db.execute(
        id
          ? sql`UPDATE ${table} SET ${sql.join(
              entries.map(([key, value]) => sql`${sql.identifier(key)}=${value}`),
              sql`,`,
            )}, updated_at=now() WHERE id=${id}::uuid RETURNING *`
          : sql`INSERT INTO ${table} (${sql.join(
              entries.map(([key]) => sql.identifier(key)),
              sql`,`,
            )}) VALUES (${sql.join(
              entries.map(([, value]) => sql`${value}`),
              sql`,`,
            )}) RETURNING *`,
      )
    ).rows;
    await audit(tx, id ? 'UPDATE' : 'CREATE', tableNames[resource], String(after.id), before, after);
    if (resource === 'projects' && !id) {
      let assignedDriverCount = 0;
      if (assignAllDrivers) {
        if (!after.active) invalid('기사에게 배정하려면 현장을 사용 중으로 등록하세요.');
        const activeDrivers = await tx.db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.role, 'DRIVER'), eq(users.status, 'ACTIVE')));
        for (const user of activeDrivers) {
          await addAssignment(tx, { user_id: user.id, project_id: after.id, valid_from: todaySeoul() });
          assignedDriverCount += 1;
        }
      }
      return { ...after, assigned_driver_count: assignedDriverCount };
    }
    return after;
  });
}
function mergedFields(value: Record<string, unknown>, shape: Record<string, unknown>) {
  return Object.fromEntries(Object.keys(shape).map((key) => [key, value[key]]));
}
export async function listUsers(ctx: Context) {
  await assertActive(ctx);
  assertAdmin(ctx);
  const rows = await ctx.db.select().from(users).orderBy(users.name, users.id);
  const assignments = await ctx.db.select().from(projectAssignments);
  const deletion = await userDeletionFlags(
    ctx,
    rows.map((user) => user.id),
  );
  return rows.map((user) => ({
    ...publicUser(user),
    ...deletion.get(user.id),
    assignments: assignments.filter((a) => a.user_id === user.id),
  }));
}
export async function updateUser(ctx: Context, id: string, raw: unknown) {
  uuid.parse(id);
  const { version, ...input } = userPatchSchema.parse(raw);
  return adminTransaction(ctx, async (tx) => {
    const [before] = await tx.db.select().from(users).where(eq(users.id, id)).for('update');
    if (!before) notFound();
    if (before.version !== version)
      throw new AppError('VERSION_CONFLICT', '사용자 정보가 변경되었습니다. 새로고침하세요.');
    const next = { ...before, ...input };
    if (next.role === 'DRIVER' && !next.driver_id) invalid('기사 연결이 필요합니다.');
    if (next.driver_id) {
      const [driver] = await tx.db.select().from(drivers).where(eq(drivers.id, next.driver_id));
      if (!driver || (!driver.active && before.driver_id !== next.driver_id))
        invalid('기사 연결을 확인하세요.');
    }
    if (next.all_projects && next.role !== 'SETTLEMENT_MANAGER' && next.role !== 'ADMIN')
      invalid('모든 현장 권한은 정산 담당자와 관리자만 사용할 수 있습니다.');
    if (
      before.role === 'ADMIN' &&
      before.status === 'ACTIVE' &&
      (next.role !== 'ADMIN' || next.status !== 'ACTIVE')
    ) {
      const admins = await tx.db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.role, 'ADMIN'), eq(users.status, 'ACTIVE')));
      if (admins.length <= 1) invalid('마지막 활성 관리자는 비활성화하거나 역할을 변경할 수 없습니다.');
    }
    const [after] = await tx.db
      .update(users)
      .set({ ...input, version: version + 1, updated_at: new Date() })
      .where(eq(users.id, id))
      .returning();
    if (after.status === 'DISABLED') {
      await tx.db
        .update(sessions)
        .set({ revoked_at: new Date(), updated_at: new Date() })
        .where(and(eq(sessions.user_id, id), isNull(sessions.revoked_at)));
      await tx.db.delete(pushSubscriptions).where(eq(pushSubscriptions.user_id, id));
    }
    await audit(tx, 'UPDATE_USER', 'user', id, publicUser(before), publicUser(after));
    return publicUser(after);
  });
}
export async function addAssignment(ctx: Context, raw: unknown) {
  const input = assignmentSchema.parse(raw);
  validateDates(input);
  return adminTransaction(ctx, async (tx) => {
    const [project] = await tx.db.select().from(projects).where(eq(projects.id, input.project_id));
    if (!project?.active) invalid('사용 중인 현장을 선택하세요.');
    const conflict = await tx.db
      .execute(sql`SELECT id FROM project_assignments WHERE user_id=${input.user_id}::uuid AND project_id=${input.project_id}::uuid AND revoked_at IS NULL
      AND valid_from <= COALESCE(${input.valid_to}::date,'infinity'::date) AND COALESCE(valid_to,'infinity'::date) >= ${input.valid_from}::date`);
    if (conflict.rows.length) invalid('같은 현장에 유효한 배정 기간이 겹칩니다.');
    const [after] = await tx.db.insert(projectAssignments).values(input).returning();
    await audit(tx, 'ASSIGN_PROJECT', 'project_assignment', after.id, null, after);
    return after;
  });
}
export async function revokeAssignment(ctx: Context, id: string) {
  uuid.parse(id);
  return adminTransaction(ctx, async (tx) => {
    const [before] = await tx.db
      .select()
      .from(projectAssignments)
      .where(eq(projectAssignments.id, id))
      .for('update');
    if (!before) notFound();
    const [after] = await tx.db
      .update(projectAssignments)
      .set({ revoked_at: new Date(), updated_at: new Date() })
      .where(eq(projectAssignments.id, id))
      .returning();
    await audit(tx, 'REVOKE_PROJECT', 'project_assignment', id, before, after);
    return after;
  });
}
export const unknownBody = z.unknown();

export async function deleteProject(ctx: Context, id: string) {
  uuid.parse(id);
  return adminTransaction(ctx, async (tx) => {
    const [before] = await tx.db.select().from(projects).where(eq(projects.id, id)).for('update');
    if (!before) notFound();
    const references = await tx.db.execute(sql`SELECT 1 WHERE
      EXISTS (SELECT 1 FROM vehicle_uses WHERE project_id=${id}::uuid) OR
      EXISTS (SELECT 1 FROM rate_agreements WHERE project_id=${id}::uuid) OR
      EXISTS (SELECT 1 FROM project_assignments WHERE project_id=${id}::uuid) OR
      EXISTS (SELECT 1 FROM form_field_settings WHERE project_id=${id}::uuid) OR
      EXISTS (SELECT 1 FROM invites WHERE project_ids ? ${id}) OR
      EXISTS (SELECT 1 FROM driver_join_links WHERE project_ids ? ${id})`);
    if (references.rows.length)
      invalid(
        '연결된 운행·계약·배정 또는 가입 링크가 있어 삭제할 수 없습니다. 수정에서 사용 중을 해제해 사용 중지하세요. 과거 기록은 보존됩니다.',
      );
    await tx.db.delete(projects).where(eq(projects.id, id));
    await audit(tx, 'DELETE_PROJECT', 'projects', id, before, null);
    return { id, deleted: true };
  });
}
