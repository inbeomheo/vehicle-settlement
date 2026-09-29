import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Context } from '../context';
import { accessibleUseFilter } from '../authz';
import { managerOnly } from './admin';
import { rawUse } from './uses';
import { uuid, dateString } from './schemas';
export const auditQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1000000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    entity_type: z.string().max(100).optional(),
    entity_id: uuid.optional(),
    user_id: uuid.optional(),
    use_id: uuid.optional(),
    search: z.string().trim().max(100).optional(),
    from: dateString.optional(),
    to: dateString.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '기간을 확인하세요.' });
function stripSecrets(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stripSecrets);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !['password_hash', 'token_hash', 'storage_key', 'invite_url'].includes(key))
      .map(([key, item]) => [key, stripSecrets(item)]),
  );
}
export async function queryAudit(ctx: Context, raw: unknown) {
  await managerOnly(ctx);
  const q = auditQuerySchema.parse(raw);
  const scope = await accessibleUseFilter(ctx);
  if (q.use_id) await rawUse(ctx, q.use_id);
  const clauses = [sql`true`];
  if (ctx.user.role !== 'ADMIN' || q.use_id)
    clauses.push(sql`EXISTS (SELECT 1 FROM vehicle_uses WHERE ${scope ?? sql`true`} ${q.use_id ? sql`AND vehicle_uses.id=${q.use_id}::uuid` : sql``} AND (
    (a.entity_type='vehicle_use' AND a.entity_id=vehicle_uses.id)
    OR (a.entity_type='charge_line' AND EXISTS (SELECT 1 FROM charge_lines cl WHERE cl.id=a.entity_id AND cl.vehicle_use_id=vehicle_uses.id))
    OR (a.entity_type='evidence' AND EXISTS (SELECT 1 FROM evidence e WHERE e.id=a.entity_id AND e.vehicle_use_id=vehicle_uses.id))))`);
  const permitted = sql.join([...clauses], sql` AND `);
  if (q.entity_type) clauses.push(sql`a.entity_type=${q.entity_type}`);
  if (q.entity_id) clauses.push(sql`a.entity_id=${q.entity_id}::uuid`);
  if (q.user_id) clauses.push(sql`a.user_id=${q.user_id}::uuid`);
  if (q.from) clauses.push(sql`a.at>=${q.from + 'T00:00:00+09:00'}::timestamptz`);
  if (q.to) clauses.push(sql`a.at<${q.to + 'T00:00:00+09:00'}::timestamptz + interval '1 day'`);
  const entityNumber = sql`COALESCE(
    (SELECT vu.use_no FROM vehicle_uses vu WHERE
      (a.entity_type='vehicle_use' AND vu.id=a.entity_id)
      OR (a.entity_type='charge_line' AND vu.id=(SELECT cl.vehicle_use_id FROM charge_lines cl WHERE cl.id=a.entity_id))
      OR (a.entity_type='evidence' AND vu.id=(SELECT e.vehicle_use_id FROM evidence e WHERE e.id=a.entity_id))),
    (SELECT s.statement_no FROM statements s WHERE
      (a.entity_type='statement' AND s.id=a.entity_id)
      OR (a.entity_type='payment' AND s.id=(SELECT p.statement_id FROM payment_records p WHERE p.id=a.entity_id)))
  )`;
  if (q.search) clauses.push(sql`strpos(lower(COALESCE(${entityNumber},'')), lower(${q.search})) > 0`);
  const result = await ctx.db
    .execute(sql`WITH filtered AS (SELECT a.*,u.name AS user_name, ${entityNumber} AS entity_no FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE ${sql.join(clauses, sql` AND `)}),
      visible_users AS (SELECT DISTINCT u.id,u.name FROM audit_logs a JOIN users u ON u.id=a.user_id WHERE ${permitted})
    SELECT (SELECT count(*)::int FROM filtered) AS total,
      COALESCE((SELECT jsonb_agg(t ORDER BY t.at DESC,t.id) FROM (SELECT * FROM filtered ORDER BY at DESC,id LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}) t),'[]'::jsonb) AS rows,
      COALESCE((SELECT jsonb_agg(u ORDER BY u.name,u.id) FROM visible_users u),'[]'::jsonb) AS user_options`);
  return {
    rows: stripSecrets(result.rows[0].rows),
    total: result.rows[0].total,
    page: q.page,
    pageSize: q.pageSize,
    user_options: result.rows[0].user_options,
  };
}
