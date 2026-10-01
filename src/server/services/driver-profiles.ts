import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Context } from '../context';
import { todaySeoul } from '../context';
import { accessibleProjectIds, assertActive, assertAdmin } from '../authz';
import { users } from '../db/schema';
import { audit } from '../audit';
import { AppError, notFound } from '../errors';
import { atomic } from './uses';
import { lockDriverIdentity, saveDriverIdentity } from './driver-identity';
import { driverProfilePatchSchema } from './driver-schemas';

export type DriverProfile = {
  id: string;
  driver_id: string;
  login_id: string;
  name: string;
  phone: string | null;
  business_name: string | null;
  biz_no: string | null;
  plate_no: string | null;
  vehicle_type: string | null;
  tonnage: string | null;
  version: number;
  status: 'ACTIVE' | 'DISABLED';
  created_at: string;
  projects: { id: string; name: string }[];
};
export async function listDriverProfiles(ctx: Context, id?: string) {
  if (id) z.string().uuid().parse(id);
  await assertActive(ctx);
  const self = ctx.user.role === 'DRIVER';
  if (self && id !== ctx.user.id) notFound();
  // The requested directory allows settlement staff to read all registered
  // drivers. This does not expand their use/settlement project permissions.
  const ids = ctx.user.role === 'SITE_MANAGER' ? await accessibleProjectIds(ctx) : null;
  const today = todaySeoul();
  const scope =
    ids === null
      ? sql`true`
      : ids.length
        ? sql`pa.project_id in (${sql.join(
            ids.map((value) => sql`${value}::uuid`),
            sql`,`,
          )})`
        : sql`false`;
  return (
    await ctx.db
      .execute(sql`SELECT u.id, u.driver_id, u.login_id, d.name, d.phone, u.version, u.status, u.created_at,
    c.name AS business_name, c.biz_no, v.plate_no, v.vehicle_type, v.tonnage,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) ORDER BY p.name) FROM projects p WHERE p.id IN
      (SELECT pa.project_id FROM project_assignments pa WHERE pa.user_id=u.id AND pa.revoked_at IS NULL AND pa.valid_from<=${today}::date AND (pa.valid_to IS NULL OR pa.valid_to>=${today}::date) AND ${scope})), '[]') AS projects
    FROM users u JOIN drivers d ON d.id=u.driver_id LEFT JOIN vehicles v ON v.id=d.default_vehicle_id
    LEFT JOIN LATERAL (SELECT counterparty_id FROM driver_affiliations WHERE driver_id=d.id AND valid_from<=${today}::date AND (valid_to IS NULL OR valid_to>=${today}::date) ORDER BY valid_from DESC, id LIMIT 1) a ON true
    LEFT JOIN counterparties c ON c.id=a.counterparty_id
    WHERE u.role='DRIVER' AND ${id ? sql`u.id=${id}::uuid` : sql`true`}
    AND ${ids === null ? sql`true` : sql`EXISTS (SELECT 1 FROM project_assignments pa WHERE pa.user_id=u.id AND pa.revoked_at IS NULL AND pa.valid_from<=${today}::date AND (pa.valid_to IS NULL OR pa.valid_to>=${today}::date) AND ${scope})`}
    ORDER BY d.name, u.id`)
  ).rows as DriverProfile[];
}
export async function getDriverProfile(ctx: Context, id: string) {
  const [row] = await listDriverProfiles(ctx, id);
  if (!row) notFound();
  return row;
}
export async function updateDriverProfile(ctx: Context, id: string, raw: unknown) {
  z.string().uuid().parse(id);
  const { version, ...input } = driverProfilePatchSchema.parse(raw);
  return atomic(ctx, async (tx) => {
    await lockDriverIdentity(tx.db);
    await assertActive(tx);
    if (tx.user.role === 'DRIVER') {
      if (id !== tx.user.id) notFound();
    } else assertAdmin(tx);
    const [user] = await tx.db.select().from(users).where(eq(users.id, id)).for('update');
    if (!user || user.role !== 'DRIVER' || !user.driver_id) notFound();
    const before = await getDriverProfile(tx, id);
    if (version !== user.version)
      throw new AppError('VERSION_CONFLICT', '기사 정보가 변경되었습니다. 새로고침 후 다시 수정하세요.', {
        current: before,
      });
    await saveDriverIdentity(tx.db, input, user.driver_id);
    await tx.db
      .update(users)
      .set({ name: input.name, phone: input.phone, version: version + 1, updated_at: new Date() })
      .where(eq(users.id, id));
    const after = await getDriverProfile(tx, id);
    await audit(tx, 'UPDATE_DRIVER_PROFILE', 'user', id, before, after);
    return after;
  });
}
