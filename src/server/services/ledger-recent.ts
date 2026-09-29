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
  const person = q.driver_id
    ? sql`vehicle_uses.driver_id=${q.driver_id}::uuid`
    : sql`vehicle_uses.created_by_user_id=${q.user_id ?? ctx.user.id}::uuid`;
  return (
    await ctx.db
      .execute(sql`SELECT vehicle_uses.project_id, max(vehicle_uses.snapshot->>'project_name') AS project_name, t.origin,t.destination,
    max(vehicle_uses.use_date)::text AS last_used, count(*)::int AS frequency
    FROM vehicle_uses JOIN trips t ON t.vehicle_use_id=vehicle_uses.id JOIN projects p ON p.id=vehicle_uses.project_id
    WHERE ${scope ?? sql`true`} AND ${person} AND p.active AND vehicle_uses.operation_status<>'CANCELED' AND t.status<>'CANCELED'
    GROUP BY vehicle_uses.project_id,t.origin,t.destination ORDER BY max(vehicle_uses.use_date) DESC,count(*) DESC,t.origin,t.destination LIMIT ${q.limit}`)
  ).rows;
}
