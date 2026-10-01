import { and, eq, inArray, isNull, lte, gte, ne, or, sql } from 'drizzle-orm';
import { counterparties, driverAffiliations, drivers, projects, vehicles, workTypes } from '../db/schema';
import type { Context } from '../context';
import { dateString } from './schemas';
import { todaySeoul } from '../context';
import { accessibleProjectIds } from '../authz';

export async function getLookups(ctx: Context, useDate?: string) {
  const ids = await accessibleProjectIds(ctx);
  const self = ctx.user.role === 'DRIVER';
  const site = ctx.user.role === 'SITE_MANAGER';
  const today = todaySeoul();
  const date = useDate ? dateString.parse(useDate) : today;
  const projectScope = ids?.length
    ? sql`IN (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`,`,
      )})`
    : sql`IN (NULL)`;
  // Assigned drivers and drivers in this site's existing work support both
  // registered drivers and historical/proxy entries without a login account.
  const driverScope = self
    ? eq(drivers.id, ctx.user.driver_id!)
    : site
      ? sql`(${drivers.id} IN (SELECT u.driver_id FROM users u JOIN project_assignments pa ON pa.user_id=u.id
          WHERE u.role='DRIVER' AND u.status='ACTIVE' AND pa.project_id ${projectScope}
          AND pa.revoked_at IS NULL AND pa.valid_from<=${today}::date AND (pa.valid_to IS NULL OR pa.valid_to>=${today}::date))
          OR ${drivers.id} IN (SELECT driver_id FROM vehicle_uses WHERE project_id ${projectScope}))`
      : undefined;
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
  const payees = affiliations.map((row) => row.counterparty_id);
  const relatedParties = payees.length ? inArray(counterparties.id, payees) : sql`false`;
  const vehicleIds = driverRows.flatMap((row) => (row.default_vehicle_id ? [row.default_vehicle_id] : []));
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
    .where(
      and(
        eq(vehicles.active, true),
        self || site
          ? or(
              vehicleIds.length ? inArray(vehicles.id, vehicleIds) : sql`false`,
              sql`${vehicles.id} IN (SELECT vehicle_id FROM vehicle_uses WHERE ${self ? sql`driver_id=${ctx.user.driver_id}::uuid AND project_id ${projectScope}` : sql`project_id ${projectScope}`})`,
            )
          : undefined,
      ),
    );
  const parties = await ctx.db
    .select({ id: counterparties.id, name: counterparties.name, kind: counterparties.kind })
    .from(counterparties)
    .where(
      and(
        eq(counterparties.active, true),
        self
          ? and(ne(counterparties.kind, 'CUSTOMER'), relatedParties)
          : site
            ? or(
                relatedParties,
                sql`${counterparties.id} IN (SELECT payee_counterparty_id FROM vehicle_uses WHERE project_id ${projectScope}
        UNION SELECT customer_counterparty_id FROM vehicle_uses WHERE project_id ${projectScope}
        UNION SELECT counterparty_id FROM rate_agreements WHERE active AND project_id ${projectScope})`,
              )
            : undefined,
      ),
    );
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
