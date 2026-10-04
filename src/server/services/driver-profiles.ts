import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Context } from '../context';
import { todaySeoul } from '../context';
import { accessibleProjectIds, assertActive, assertAdmin } from '../authz';
import { users, driverAffiliations } from '../db/schema';
import { audit } from '../audit';
import { AppError, invalid, notFound } from '../errors';
import { atomic } from './uses';
import { lockDriverIdentity, saveDriverIdentity } from './driver-identity';
import { dateString, uuid } from './schemas';
import { driverProfilePatchSchema } from './driver-schemas';

export type DriverProfile = {
  id: string;
  driver_id: string;
  login_id: string;
  name: string;
  phone: string | null;
  business_name: string | null;
  biz_no: string | null;
  representative_name: string | null;
  address: string | null;
  business_type: string | null;
  business_item: string | null;
  business_details_editable: boolean;
  plate_no: string | null;
  vehicle_type: string | null;
  tonnage: string | null;
  version: number;
  status: 'ACTIVE' | 'DISABLED';
  created_at: string;
  projects: { id: string; name: string }[];
  affiliations: { id: string; business_name: string; valid_from: string; valid_to: string | null }[];
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
    c.name AS business_name, c.biz_no,
    ${ctx.user.role === 'SITE_MANAGER' ? sql`NULL::text` : sql`c.representative_name`} AS representative_name,
    ${ctx.user.role === 'SITE_MANAGER' ? sql`NULL::text` : sql`c.address`} AS address,
    c.business_type, c.business_item,
    (c.kind='DRIVER_BUSINESS' AND NOT EXISTS (SELECT 1 FROM driver_affiliations shared WHERE shared.counterparty_id=c.id AND shared.driver_id<>d.id)) AS business_details_editable,
    v.plate_no, v.vehicle_type, v.tonnage,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id', da.id, 'business_name', cp.name, 'valid_from', da.valid_from, 'valid_to', da.valid_to) ORDER BY da.valid_from DESC, da.id)
      FROM driver_affiliations da JOIN counterparties cp ON cp.id=da.counterparty_id WHERE da.driver_id=d.id), '[]') AS affiliations,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) ORDER BY p.name) FROM projects p WHERE p.active AND p.id IN
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
    await saveDriverIdentity(tx.db, input, user.driver_id, tx.user.role === 'ADMIN');
    await tx.db
      .update(users)
      .set({ name: input.name, phone: input.phone, version: version + 1, updated_at: new Date() })
      .where(eq(users.id, id));
    const after = await getDriverProfile(tx, id);
    await audit(tx, 'UPDATE_DRIVER_PROFILE', 'user', id, before, after);
    return after;
  });
}

const affiliationPatchSchema = z
  .object({
    version: z.number().int().positive(),
    affiliation_id: uuid,
    valid_from: dateString,
  })
  .strict();

export async function updateDriverAffiliation(ctx: Context, id: string, raw: unknown) {
  uuid.parse(id);
  const input = affiliationPatchSchema.parse(raw);
  return atomic(ctx, async (tx) => {
    await assertActive(tx);
    if (!['ADMIN', 'SETTLEMENT_MANAGER'].includes(tx.user.role))
      throw new AppError('FORBIDDEN', '소속 시작일은 관리자 또는 정산 담당자만 변경할 수 있습니다.');
    await lockDriverIdentity(tx.db);
    const [user] = await tx.db.select().from(users).where(eq(users.id, id)).for('update');
    if (!user || user.role !== 'DRIVER' || !user.driver_id) notFound();
    if (input.version !== user.version)
      throw new AppError('VERSION_CONFLICT', '기사 정보가 변경되었습니다. 새로고침 후 다시 수정하세요.');
    const affiliations = await tx.db
      .select()
      .from(driverAffiliations)
      .where(eq(driverAffiliations.driver_id, user.driver_id))
      .for('update');
    const before = affiliations.find((row) => row.id === input.affiliation_id);
    if (!before) notFound();
    if (before.valid_to && input.valid_from > before.valid_to)
      invalid('소속 시작일은 종료일보다 늦을 수 없습니다.');
    if (
      affiliations.some(
        (row) =>
          row.id !== before.id &&
          (!row.valid_to || row.valid_to >= input.valid_from) &&
          (!before.valid_to || row.valid_from <= before.valid_to),
      )
    )
      invalid('같은 기사의 다른 소속 기간과 겹칩니다. 소속 시작일을 확인하세요.');
    if (input.valid_from > before.valid_from) {
      const referenced = await tx.db.execute(sql`SELECT id FROM vehicle_uses
        WHERE driver_id=${user.driver_id}::uuid AND payee_counterparty_id=${before.counterparty_id}::uuid
          AND use_date>=${before.valid_from}::date AND use_date<${input.valid_from}::date LIMIT 1`);
      if (referenced.rows.length) invalid('이미 등록된 운행일을 소속 기간에서 제외할 수 없습니다.');
    }
    const [after] = await tx.db
      .update(driverAffiliations)
      .set({ valid_from: input.valid_from, updated_at: new Date() })
      .where(eq(driverAffiliations.id, before.id))
      .returning();
    await tx.db
      .update(users)
      .set({ version: user.version + 1, updated_at: new Date() })
      .where(eq(users.id, id));
    await audit(tx, 'UPDATE_DRIVER_AFFILIATION', 'driver_affiliations', before.id, before, after);
    return { id, version: user.version + 1 };
  });
}
