import { proposedSupply } from '../../shared/charge-amount';
import { sumMoney } from '../domain/money';
import type { Charge } from './uses';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Context } from '../context';
import { accessibleUseFilter } from '../authz';
import { notFound } from '../errors';
import { uuid } from './schemas';
export const recentQuerySchema = z.object({
  driver_id: uuid.optional(),
  user_id: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});
export async function getRecentRoutes(ctx: Context, raw: unknown) {
  const q = recentQuerySchema.parse(raw);
  const scope = await accessibleUseFilter(ctx);
  if (
    ctx.user.role === 'DRIVER' &&
    ((q.driver_id && q.driver_id !== ctx.user.driver_id) || (q.user_id && q.user_id !== ctx.user.id))
  )
    notFound();
  const driverId = q.driver_id;
  const person = driverId
    ? sql`vehicle_uses.driver_id=${driverId}::uuid`
    : sql`vehicle_uses.created_by_user_id=${q.user_id ?? ctx.user.id}::uuid`;
  return (
    await ctx.db.execute(sql`
      WITH scoped AS (
        SELECT vehicle_uses.* FROM vehicle_uses JOIN projects p ON p.id=vehicle_uses.project_id
        WHERE ${scope ?? sql`true`} AND ${person} AND p.active AND vehicle_uses.operation_status<>'CANCELED'
      ), routes AS (
        SELECT scoped.project_id, max(scoped.snapshot->>'project_name') AS project_name,
          t.origin,t.destination,max(scoped.use_date)::text AS last_used,count(*)::int AS frequency
        FROM scoped JOIN trips t ON t.vehicle_use_id=scoped.id WHERE t.status<>'CANCELED'
        GROUP BY scoped.project_id,t.origin,t.destination
        ORDER BY max(scoped.use_date) DESC,count(*) DESC,t.origin,t.destination LIMIT ${q.limit}
      ) SELECT routes.*, previous.snapshot AS last_snapshot
        FROM routes LEFT JOIN LATERAL (
          SELECT r.snapshot FROM scoped vu JOIN LATERAL (
            SELECT snapshot, submitted_at FROM use_revisions
            WHERE vehicle_use_id=vu.id AND snapshot->>'driver_id'=vu.driver_id::text
            ORDER BY revision_no DESC LIMIT 1
          ) r ON true
          WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(r.snapshot->'trips') t
            WHERE t->>'origin'=routes.origin AND t->>'destination'=routes.destination AND t->>'status'<>'CANCELED')
          ORDER BY r.submitted_at DESC,vu.created_at DESC,vu.id DESC LIMIT 1
        ) previous ON true
      ORDER BY routes.last_used DESC,routes.frequency DESC,routes.origin,routes.destination
    `)
  ).rows.map(({ last_snapshot, ...route }) => {
    // Reuse the submitted proposal, never a later edit that the driver has not sent yet.
    // The snapshot and every RECEIVABLE field stay inside this service.
    const lines = (last_snapshot as { charge_lines: Charge[] } | null)?.charge_lines ?? [];
    const amounts = lines
      .filter(
        (line) =>
          line.direction === 'PAYABLE' &&
          line.charge_type === 'BASE' &&
          !line.deleted_at &&
          line.line_review_status !== 'REJECTED',
      )
      .map(proposedSupply);
    return {
      ...route,
      last_amount: !amounts.length || amounts.some((amount) => amount === null) ? null : sumMoney(amounts),
    };
  });
}
