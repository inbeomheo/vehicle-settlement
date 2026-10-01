import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Context } from '../context';
import { todaySeoul } from '../context';
import { accessibleUseFilter } from '../authz';
import { dateString, uuid } from './schemas';
import { getLedger } from './ledger';
import { listUses } from './uses';
import { reviewSupplySql } from './charge-amount-sql';

export const approvalQuerySchema = z
  .object({
    from: dateString.default(todaySeoul),
    to: dateString.default(todaySeoul),
    project_id: uuid.optional(),
    driver_id: uuid.optional(),
    reviewer_user_id: z.union([uuid, z.literal('me')]).optional(),
    transport_search: z.string().trim().max(100).optional(),
    review_status: z.enum(['DRAFT', 'SUBMITTED', 'NEEDS_FIX', 'APPROVED']).optional(),
    page: z.coerce.number().int().min(1).max(1000000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine((q) => q.from <= q.to, { message: '운송일자 종료일을 확인하세요.', path: ['to'] });

type Option = { id: string; name: string };
export async function getApprovals(ctx: Context, raw: unknown, exportAll = false) {
  const q = approvalQuerySchema.parse(raw);
  const scope = await accessibleUseFilter(ctx);
  const driver = ctx.user.role === 'DRIVER';
  const reviewer = q.reviewer_user_id === 'me' ? ctx.user.id : q.reviewer_user_id;
  const clauses: SQL[] = [scope ?? sql`true`, sql`use_date BETWEEN ${q.from}::date AND ${q.to}::date`];
  if (q.project_id) clauses.push(sql`project_id=${q.project_id}::uuid`);
  if (q.driver_id) clauses.push(sql`driver_id=${q.driver_id}::uuid`);
  if (reviewer) clauses.push(sql`reviewer_user_id=${reviewer}::uuid`);
  if (q.transport_search) {
    const pattern = '%' + q.transport_search.replace(/[\\%_]/g, '\\$&') + '%';
    clauses.push(
      sql`(cargo_desc ILIKE ${pattern} OR EXISTS (SELECT 1 FROM trips WHERE vehicle_use_id=vehicle_uses.id AND concat_ws(' ',origin,destination,cargo_desc) ILIKE ${pattern}))`,
    );
  }
  // Only the selected status is omitted from counts. Scope is applied before every aggregate.
  const result = await ctx.db.execute(sql`
    WITH filtered AS (SELECT * FROM vehicle_uses WHERE ${sql.join(clauses, sql` AND `)}),
    selected AS (SELECT * FROM filtered WHERE ${q.review_status ? sql`review_status=${q.review_status} AND operation_status<>'CANCELED'` : sql`true`}),
    amounts AS (SELECT selected.id, selected.operation_status,
      count(*) FILTER (WHERE cl.id IS NOT NULL AND ${reviewSupplySql} IS NULL)::int AS unknown_count,
      sum(${reviewSupplySql}) AS amount
      FROM selected LEFT JOIN charge_lines cl ON cl.vehicle_use_id=selected.id AND cl.direction='PAYABLE' AND cl.deleted_at IS NULL AND cl.line_review_status<>'REJECTED'
      GROUP BY selected.id,selected.operation_status)
    SELECT (SELECT count(*)::int FROM filtered) AS all_count,
      (SELECT COALESCE(jsonb_object_agg(review_status,n),'{}'::jsonb) FROM (SELECT review_status,count(*)::int AS n FROM filtered WHERE operation_status<>'CANCELED' GROUP BY review_status) c) AS counts,
      (SELECT count(*)::int FROM amounts WHERE operation_status<>'CANCELED') AS count,
      (SELECT COALESCE(sum(amount),0)::text FROM amounts WHERE operation_status<>'CANCELED') AS amount,
      (SELECT COALESCE(sum(unknown_count),0)::int FROM amounts WHERE operation_status<>'CANCELED') AS unknown_count`);
  const summary = result.rows[0];
  const optionResult = await ctx.db
    .execute(sql`SELECT vehicle_uses.project_id, vehicle_uses.driver_id, vehicle_uses.reviewer_user_id,
    max(snapshot->>'project_name') AS project_name, max(snapshot->>'driver_name') AS driver_name, max(u.name) AS reviewer_name
    FROM vehicle_uses LEFT JOIN users u ON u.id=vehicle_uses.reviewer_user_id
    WHERE ${scope ?? sql`true`} GROUP BY vehicle_uses.project_id,vehicle_uses.driver_id,vehicle_uses.reviewer_user_id`);
  const options = (id: string, name: string): Option[] =>
    [
      ...new Map(
        optionResult.rows
          .filter((r) => r[id])
          .map((r) => [String(r[id]), { id: String(r[id]), name: String(r[name] ?? '이름 없음') }]),
      ).values(),
    ].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const query = { ...q, reviewer_user_id: reviewer, exclude_canceled: q.review_status ? 'true' : undefined };
  // Drivers go through the existing driver redaction and never receive ledger customer amounts.
  const list = driver ? await listUses(ctx, query) : await getLedger(ctx, query, exportAll);
  const amount = Number(summary.amount);
  if (!Number.isSafeInteger(amount)) throw new RangeError('합계 금액 범위를 초과했습니다.');
  return {
    ...list,
    counts: {
      ALL: Number(summary.all_count),
      DRAFT: 0,
      SUBMITTED: 0,
      NEEDS_FIX: 0,
      APPROVED: 0,
      ...(summary.counts as Record<string, number>),
    },
    summary: { count: Number(summary.count), amount, unknown_count: Number(summary.unknown_count) },
    options: {
      projects: options('project_id', 'project_name'),
      drivers: driver ? [] : options('driver_id', 'driver_name'),
      reviewers: driver ? [] : options('reviewer_user_id', 'reviewer_name'),
    },
  };
}
