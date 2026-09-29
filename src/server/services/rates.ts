import { and, eq, lte, gte, isNull, or, desc } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { driverAffiliations, rateAgreements, vehicles } from '../db/schema';
import type { Db } from '../db/client';
import type { Context } from '../context';
import { assertProjectAccess, canSeeReceivable } from '../authz';
import { notFound } from '../errors';
import { rateLookupSchema } from './schemas';
export type RateQuery = { project_id: string; counterparty_id: string; vehicle_id: string; use_date: string; direction: 'PAYABLE' | 'RECEIVABLE'; billing_unit?: typeof rateAgreements.$inferSelect.billing_unit };
export async function findRate(db: Db, q: RateQuery) {
  const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, q.vehicle_id)); if (!vehicle) notFound();
  const rates = await db.select().from(rateAgreements).where(and(eq(rateAgreements.active, true), eq(rateAgreements.direction, q.direction), eq(rateAgreements.counterparty_id, q.counterparty_id), lte(rateAgreements.valid_from, q.use_date), or(isNull(rateAgreements.valid_to), gte(rateAgreements.valid_to, q.use_date)), or(isNull(rateAgreements.project_id), eq(rateAgreements.project_id, q.project_id)), or(isNull(rateAgreements.vehicle_type), eq(rateAgreements.vehicle_type, vehicle.vehicle_type)), q.billing_unit ? eq(rateAgreements.billing_unit, q.billing_unit) : undefined)).orderBy(desc(rateAgreements.valid_from), desc(rateAgreements.created_at), desc(rateAgreements.id));
  const score = (r: typeof rateAgreements.$inferSelect) => Number(r.project_id !== null) * 4 + Number(r.vehicle_type !== null) * 2 + Number(r.tonnage !== null);
  return rates.filter(r => r.tonnage === null || new Decimal(r.tonnage).eq(vehicle.tonnage)).sort((a, b) => score(b) - score(a))[0] ?? null;
}
export function suggestedQuantity(unit: typeof rateAgreements.$inferSelect.billing_unit, trips: number) { return ['PER_DAY', 'HALF_DAY', 'MONTHLY', 'LUMP_SUM'].includes(unit) ? '1' : unit === 'PER_TRIP' ? String(trips) : null; }
export async function lookupRate(ctx: Context, raw: unknown) {
  const q = rateLookupSchema.parse(raw); await assertProjectAccess(ctx, q.project_id);
  if (!canSeeReceivable(ctx)) {
    if (q.direction === 'RECEIVABLE') notFound();
    const [aff] = await ctx.db.select().from(driverAffiliations).where(and(eq(driverAffiliations.driver_id, ctx.user.driver_id!), eq(driverAffiliations.counterparty_id, q.counterparty_id), lte(driverAffiliations.valid_from, q.use_date), or(isNull(driverAffiliations.valid_to), gte(driverAffiliations.valid_to, q.use_date)))); if (!aff) notFound();
  }
  const rate = await findRate(ctx.db, q); const unit = rate?.billing_unit ?? q.billing_unit ?? 'PER_DAY';
  return { rate, price_status: rate ? 'CONFIRMED' : 'PENDING', suggested_quantity: suggestedQuantity(unit, q.completed_trips) };
}
