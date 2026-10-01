import { and, eq, inArray, isNull, lte, gte, or, sql } from 'drizzle-orm';
import { counterparties, driverAffiliations, drivers, projects, vehicles, workTypes } from '../db/schema';
import type { Context } from '../context';
import { dateString } from './schemas';
import { todaySeoul } from '../context';
import { accessibleProjectIds } from '../authz';
import { counterpartySelectionFilter, driverVehicleSelectionFilter } from '../selection-scope';

export async function getLookups(ctx: Context, useDate?: string) {
  const ids = await accessibleProjectIds(ctx);
  const self = ctx.user.role === 'DRIVER';
  const site = ctx.user.role === 'SITE_MANAGER';
  const today = todaySeoul();
  const date = useDate ? dateString.parse(useDate) : today;
  // Internal active name lists also support new drivers without an account or work history.
  const driverScope = self ? eq(drivers.id, ctx.user.driver_id!) : undefined;
  const driverRows = await ctx.db
    .select({ id: drivers.id, name: drivers.name, default_vehicle_id: drivers.default_vehicle_id })
    .from(drivers)
    .where(and(eq(drivers.active, true), driverScope));
  const driverIds = driverRows.map((row) => row.id);
  const affiliations = await ctx.db
    .select({
      id: driverAffiliations.id,
      driver_id: driverAffiliations.driver_id,
      counterparty_id: driverAffiliations.counterparty_id,
      valid_from: driverAffiliations.valid_from,
      valid_to: driverAffiliations.valid_to,
    })
    .from(driverAffiliations)
    .where(
      and(
        self || site
          ? driverIds.length
            ? inArray(driverAffiliations.driver_id, driverIds)
            : sql`false`
          : undefined,
        lte(driverAffiliations.valid_from, date),
        or(isNull(driverAffiliations.valid_to), gte(driverAffiliations.valid_to, date)),
      ),
    );
  const projectRows = await ctx.db
    .select({
      id: projects.id,
      name: projects.name,
      code: projects.code,
      evidence_policy: projects.evidence_policy,
    })
    .from(projects)
    .where(
      and(
        eq(projects.active, true),
        ids === null ? undefined : ids.length ? inArray(projects.id, ids) : sql`false`,
      ),
    );
  const vehicleRows = await ctx.db
    .select({
      id: vehicles.id,
      plate_no: vehicles.plate_no,
      vehicle_type: vehicles.vehicle_type,
      tonnage: vehicles.tonnage,
    })
    .from(vehicles)
    .where(and(eq(vehicles.active, true), self ? driverVehicleSelectionFilter(ctx, ids) : undefined));
  const parties = await ctx.db
    .select({ id: counterparties.id, name: counterparties.name, kind: counterparties.kind })
    .from(counterparties)
    .where(counterpartySelectionFilter(ctx, date, ids));
  const works = await ctx.db
    .select({ id: workTypes.id, name: workTypes.name })
    .from(workTypes)
    .where(eq(workTypes.active, true));
  return {
    projects: projectRows,
    drivers: driverRows,
    vehicles: vehicleRows,
    counterparties: parties,
    work_types: works,
    affiliations,
  };
}
