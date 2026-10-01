import { and, eq, ne, or, sql } from 'drizzle-orm';
import type { Context } from './context';
import { counterparties, vehicles } from './db/schema';
import { assertProjectAccess } from './authz';
import { notFound } from './errors';

function projectScope(ids: string[] | null) {
  return ids === null
    ? sql`IS NOT NULL`
    : ids.length
      ? sql`IN (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`,`,
        )})`
      : sql`IN (NULL)`;
}

// Shared by lookups, use saves and rate lookup. Global contracts alone never
// grant a site manager access to a customer.
export function counterpartySelectionFilter(ctx: Context, date: string, projectIds: string[] | null) {
  const scope = projectScope(projectIds);
  const affiliation = sql`${counterparties.id} IN (
    SELECT a.counterparty_id FROM driver_affiliations a JOIN drivers d ON d.id=a.driver_id
    WHERE d.active AND a.valid_from<=${date}::date
      AND (a.valid_to IS NULL OR a.valid_to>=${date}::date)
      ${ctx.user.role === 'DRIVER' ? sql`AND d.id=${ctx.user.driver_id}::uuid` : sql``}
  )`;
  return and(
    eq(counterparties.active, true),
    ctx.user.role === 'DRIVER'
      ? and(ne(counterparties.kind, 'CUSTOMER'), affiliation)
      : ctx.user.role === 'SITE_MANAGER'
        ? or(
            eq(counterparties.kind, 'DRIVER_BUSINESS'),
            and(ne(counterparties.kind, 'CUSTOMER'), affiliation),
            sql`${counterparties.id} IN (
              SELECT payee_counterparty_id FROM vehicle_uses WHERE project_id ${scope}
              UNION SELECT customer_counterparty_id FROM vehicle_uses WHERE project_id ${scope}
              UNION SELECT counterparty_id FROM rate_agreements WHERE active AND project_id ${scope}
            )`,
          )
        : undefined,
  );
}

export async function assertCounterpartySelection(
  ctx: Context,
  input: {
    project_id: string;
    counterparty_id: string;
    use_date: string;
    direction: 'PAYABLE' | 'RECEIVABLE';
  },
) {
  await assertProjectAccess(ctx, input.project_id);
  if (ctx.user.role === 'DRIVER' && input.direction === 'RECEIVABLE') notFound();
  const [party] = await ctx.db
    .select({ id: counterparties.id })
    .from(counterparties)
    .where(
      and(
        eq(counterparties.id, input.counterparty_id),
        input.direction === 'RECEIVABLE'
          ? eq(counterparties.kind, 'CUSTOMER')
          : ne(counterparties.kind, 'CUSTOMER'),
        counterpartySelectionFilter(ctx, input.use_date, [input.project_id]),
      ),
    );
  if (!party) notFound();
}

export function driverVehicleSelectionFilter(ctx: Context, projectIds: string[] | null) {
  const scope = projectScope(projectIds);
  return and(
    eq(vehicles.active, true),
    sql`NOT EXISTS (SELECT 1 FROM drivers d WHERE d.active
      AND d.id IS DISTINCT FROM ${ctx.user.driver_id}::uuid AND d.default_vehicle_id=${vehicles.id})`,
    or(
      sql`${vehicles.id} IN (SELECT default_vehicle_id FROM drivers WHERE active AND id=${ctx.user.driver_id}::uuid)`,
      sql`${vehicles.id} IN (SELECT vehicle_id FROM vehicle_uses
        WHERE driver_id=${ctx.user.driver_id}::uuid AND project_id ${scope}
          AND (review_status='APPROVED' OR entered_as='PROXY'))`,
    ),
  );
}

export async function assertDriverVehicleSelection(
  ctx: Context,
  vehicleId: string,
  projectIds: string[] | null,
) {
  const [vehicle] = await ctx.db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(and(eq(vehicles.id, vehicleId), driverVehicleSelectionFilter(ctx, projectIds)));
  if (!vehicle) notFound();
}
