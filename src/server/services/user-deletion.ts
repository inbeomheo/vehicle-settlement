import { eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Context } from '../context';
import { users } from '../db/schema';
import { publicUser } from '../auth/session';
import { audit } from '../audit';
import { AppError, invalid } from '../errors';
import { assertActive, assertAdmin } from '../authz';
import { atomic } from './uses';
import { lockDriverIdentity } from './driver-identity';
import { uuid } from './schemas';

export const recordDeletionReason = "운행·정산 기록이 있어 삭제할 수 없어요. '계정 끄기'를 쓰세요.";
// These references contain account infrastructure, not business records.
const accountTables = new Set([
  'sessions',
  'push_subscriptions',
  'password_resets',
  'project_assignments',
  'driver_registrations',
  'invites',
  'driver_join_links',
  'idempotency_keys',
  'audit_logs',
]);
type Reference = { table_name: string; column_name: string; schema_name: string };
async function references(ctx: Context, target: string): Promise<Reference[]> {
  // Read actual FKs, including future business tables, in this connection's schema.
  return (
    await ctx.db
      .execute(sql`SELECT ns.nspname AS schema_name, t.relname AS table_name, a.attname AS column_name
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    JOIN pg_namespace ns ON ns.oid=t.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
    WHERE c.contype='f' AND c.confrelid=to_regclass(${target})`)
  ).rows as Reference[];
}
function table(ref: Reference) {
  return sql`${sql.identifier(ref.schema_name)}.${sql.identifier(ref.table_name)}`;
}
function referenced(refs: Reference[], value: SQL) {
  return refs.length
    ? sql.join(
        refs.map(
          (ref) =>
            sql`EXISTS (SELECT 1 FROM ${table(ref)} r WHERE r.${sql.identifier(ref.column_name)}=${value})`,
        ),
        sql` OR `,
      )
    : sql`false`;
}
async function businessPredicate(ctx: Context) {
  const userRefs = (await references(ctx, 'users')).filter((ref) => !accountTables.has(ref.table_name));
  const driverRefs = (await references(ctx, 'drivers')).filter(
    (ref) => !['users', 'invites', 'driver_affiliations'].includes(ref.table_name),
  );
  return sql`(${referenced(userRefs, sql`u.id`)}) OR (${referenced(driverRefs, sql`u.driver_id`)}) OR
    EXISTS (SELECT 1 FROM statement_items si WHERE si.snapshot->>'driver_id'=u.driver_id::text) OR
    EXISTS (SELECT 1 FROM use_revisions ur WHERE ur.snapshot->>'driver_id'=u.driver_id::text)`;
}
export type UserDeletion = { deletable: boolean; delete_reason: string | null };
export async function userDeletionFlags(ctx: Context, ids: string[]) {
  const result = new Map<string, UserDeletion>();
  if (!ids.length) return result;
  if (ctx.user.role !== 'ADMIN') {
    for (const id of ids)
      result.set(id, { deletable: false, delete_reason: '관리자만 계정을 삭제할 수 있어요.' });
    return result;
  }
  const predicate = await businessPredicate(ctx);
  const rows = (
    await ctx.db.execute(sql`SELECT u.id,
    CASE
      WHEN u.role='ADMIN' AND u.status='ACTIVE' AND (SELECT count(*) FROM users WHERE role='ADMIN' AND status='ACTIVE')<=1
        THEN '마지막 활성 관리자는 삭제할 수 없어요.'
      WHEN u.id=${ctx.user.id}::uuid THEN '내 계정은 직접 삭제할 수 없어요.'
      WHEN ${predicate} THEN ${recordDeletionReason}
      ELSE NULL END AS reason
    FROM users u WHERE u.id IN (${sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`,`,
    )})`)
  ).rows;
  for (const row of rows)
    result.set(String(row.id), {
      deletable: row.reason === null,
      delete_reason: row.reason as string | null,
    });
  return result;
}
async function deleteUnreferenced(ctx: Context, target: string, id: string, condition = sql`true`) {
  const t = sql.identifier(target);
  const locked = await ctx.db.execute(
    sql`SELECT id FROM ${t} WHERE id=${id}::uuid AND ${condition} FOR UPDATE`,
  );
  if (!locked.rows.length) return;
  const refs = await references(ctx, target);
  await ctx.db.execute(
    sql`DELETE FROM ${t} WHERE id=${id}::uuid AND NOT (${referenced(refs, sql`${id}::uuid`)})`,
  );
}
export async function deleteUser(ctx: Context, id: string, raw: unknown) {
  uuid.parse(id);
  const { version } = z.object({ version: z.number().int().positive() }).strict().parse(raw);
  return atomic(ctx, async (tx) => {
    await lockDriverIdentity(tx.db);
    await assertActive(tx);
    assertAdmin(tx);
    const [before] = await tx.db.select().from(users).where(eq(users.id, id)).for('update');
    if (!before) return { id, deleted: true };
    if (before.version !== version)
      throw new AppError('VERSION_CONFLICT', '사용자 정보가 변경되었습니다. 새로고침하세요.');
    // FK writers take KEY SHARE on these rows; lock before checking every reference.
    const driver = before.driver_id
      ? (await tx.db.execute(sql`SELECT * FROM drivers WHERE id=${before.driver_id}::uuid FOR UPDATE`))
          .rows[0]
      : undefined;
    const flag = (await userDeletionFlags(tx, [id])).get(id)!;
    if (!flag.deletable) invalid(flag.delete_reason!);
    // Remove registration receipts before their invitation/link parents. Other accounts stay intact.
    await tx.db.execute(sql`DELETE FROM driver_registrations WHERE user_id=${id}::uuid
      OR invite_id IN (SELECT id FROM invites WHERE created_by=${id}::uuid OR used_by_user_id=${id}::uuid)
      OR link_id IN (SELECT id FROM driver_join_links WHERE created_by=${id}::uuid)`);
    await tx.db.execute(sql`DELETE FROM invites WHERE created_by=${id}::uuid OR used_by_user_id=${id}::uuid`);
    await tx.db.execute(sql`DELETE FROM driver_join_links WHERE created_by=${id}::uuid`);
    await tx.db.execute(sql`DELETE FROM password_resets WHERE user_id=${id}::uuid OR created_by=${id}::uuid`);
    for (const name of ['push_subscriptions', 'sessions', 'project_assignments', 'idempotency_keys'])
      await tx.db.execute(sql`DELETE FROM ${sql.identifier(name)} WHERE user_id=${id}::uuid`);
    await tx.db.execute(sql`UPDATE audit_logs SET user_id=NULL WHERE user_id=${id}::uuid`);
    await tx.db.delete(users).where(eq(users.id, id));
    if (driver) {
      // Pending invitations and other linked accounts own this driver too: preserve it and its affiliations.
      const refs = (await references(tx, 'drivers')).filter(
        (ref) => ref.table_name !== 'driver_affiliations',
      );
      const remaining = await tx.db.execute(sql`SELECT 1 WHERE ${referenced(refs, sql`${driver.id}::uuid`)}`);
      if (!remaining.rows.length) {
        const affiliations = (
          await tx.db.execute(
            sql`DELETE FROM driver_affiliations WHERE driver_id=${driver.id}::uuid RETURNING counterparty_id`,
          )
        ).rows;
        await tx.db.execute(sql`DELETE FROM drivers WHERE id=${driver.id}::uuid`);
        for (const partyId of new Set(affiliations.map((a) => String(a.counterparty_id))))
          await deleteUnreferenced(tx, 'counterparties', partyId, sql`kind='DRIVER_BUSINESS'`);
        if (driver.default_vehicle_id)
          await deleteUnreferenced(tx, 'vehicles', String(driver.default_vehicle_id));
      }
    }
    await audit(tx, 'DELETE_USER', 'user', id, publicUser(before), null);
    return { id, deleted: true };
  });
}
