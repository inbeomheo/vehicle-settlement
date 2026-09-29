import { and, eq, inArray, isNull, lte, gte, or, sql } from 'drizzle-orm';
import { counterparties, driverAffiliations, drivers, projects, vehicles, workTypes } from '../db/schema';
import type { Context } from '../context';
import { todaySeoul } from '../context';
import { accessibleProjectIds, redactForDriver } from '../authz';
export async function getLookups(ctx: Context) {
  const ids = await accessibleProjectIds(ctx); const driver = ctx.user.role === 'DRIVER';
  const today = todaySeoul();
  const affiliations = await ctx.db.select().from(driverAffiliations).where(and(driver ? eq(driverAffiliations.driver_id, ctx.user.driver_id!) : undefined, lte(driverAffiliations.valid_from, today), or(isNull(driverAffiliations.valid_to), gte(driverAffiliations.valid_to, today))));
  const payees = affiliations.map(a => a.counterparty_id);
  const [projectRows, driverRows, vehicleRows, parties, works] = await Promise.all([
    ctx.db.select().from(projects).where(and(eq(projects.active, true), ids === null ? undefined : ids.length ? inArray(projects.id, ids) : sql`false`)),
    ctx.db.select().from(drivers).where(and(eq(drivers.active, true), driver ? eq(drivers.id, ctx.user.driver_id!) : undefined)),
    ctx.db.select().from(vehicles).where(eq(vehicles.active, true)),
    ctx.db.select().from(counterparties).where(and(eq(counterparties.active, true), driver ? payees.length ? inArray(counterparties.id, payees) : sql`false` : undefined)),
    ctx.db.select().from(workTypes).where(eq(workTypes.active, true)),
  ]);
  return redactForDriver(ctx, { projects: projectRows, drivers: driverRows, vehicles: vehicleRows, counterparties: parties, work_types: works, affiliations });
}
