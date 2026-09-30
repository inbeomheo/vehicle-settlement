import { and, asc, eq, gte, lte, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Context } from '../context';
import { accessibleUseFilter, assertActive } from '../authz';
import { chargeLines, paymentRecords, statementItems, statements, vehicleUses, trips } from '../db/schema';
import { calculateTax, sumMoney } from '../domain/money';
import { notFound } from '../errors';
import { driverSettlementSchema } from './statements-schemas';
import type { ItemSnapshot } from './statements';
import { routeSummary } from '../domain/route-summary';
import { groupDriverUses } from './driver-use-groups';
export async function driverSettlements(ctx: Context, input: z.input<typeof driverSettlementSchema>) {
  const query = driverSettlementSchema.parse(input);
  await assertActive(ctx);
  if (ctx.user.role !== 'DRIVER') notFound();
  const useScope = await accessibleUseFilter(ctx);
  const uses = await ctx.db
    .select()
    .from(vehicleUses)
    .where(
      and(useScope, gte(vehicleUses.use_date, query.periodStart), lte(vehicleUses.use_date, query.periodEnd)),
    )
    .orderBy(asc(vehicleUses.use_date));
  const ids = uses.map((use) => use.id);
  const lines = ids.length
    ? await ctx.db
        .select()
        .from(chargeLines)
        .where(
          and(
            inArray(chargeLines.vehicle_use_id, ids),
            eq(chargeLines.direction, 'PAYABLE'),
            isNull(chargeLines.deleted_at),
          ),
        )
    : [];
  const tripRows = ids.length
    ? await ctx.db.select().from(trips).where(inArray(trips.vehicle_use_id, ids)).orderBy(asc(trips.seq))
    : [];
  const linesByUse = Map.groupBy(lines, (line) => line.vehicle_use_id);
  const tripsByUse = Map.groupBy(tripRows, (trip) => trip.vehicle_use_id);
  const summaries = uses.map((use) => {
    const costs = linesByUse.get(use.id) ?? [];
    const routes = tripsByUse.get(use.id) ?? [];
    const pending = costs.filter((line) => ['PENDING', 'HELD'].includes(line.line_review_status));
    const estimates = pending.map((line) => {
      if (line.included_in_base) return 0;
      const amount = line.computed_amount ?? line.requested_amount;
      if (amount === null) return null;
      return line.charge_type === 'ADJUSTMENT' ? amount : calculateTax(amount, line.tax_mode).supply;
    });
    return {
      id: use.id,
      use_no: use.use_no,
      use_date: use.use_date,
      review_status: use.review_status,
      operation_status: use.operation_status,
      project_id: use.project_id,
      project_name: String(use.snapshot?.project_name ?? ''),
      route_summary: routeSummary(routes),
      trip_count: routes.filter((trip) => trip.status !== 'CANCELED').length,
      held_count: costs.filter((line) => line.line_review_status === 'HELD').length,
      // Same approved PAYABLE supply as the ledger and the existing driver view.
      approved_supply: sumMoney(
        costs.filter((line) => line.line_review_status === 'APPROVED').map((line) => line.approved_amount),
      ),
      pending_supply: sumMoney(estimates),
      pending_count: pending.length,
      unpriced_count: estimates.filter((amount) => amount === null).length,
    };
  });
  const rows = await ctx.db
    .select({ statement: statements, item: statementItems })
    .from(statementItems)
    .innerJoin(statements, eq(statements.id, statementItems.statement_id))
    .innerJoin(chargeLines, eq(chargeLines.id, statementItems.charge_line_id))
    .innerJoin(vehicleUses, eq(vehicleUses.id, chargeLines.vehicle_use_id))
    .where(
      and(
        useScope,
        eq(statements.direction, 'PAYABLE'),
        eq(statements.status, 'CONFIRMED'),
        eq(statementItems.inclusion, 'INCLUDED'),
        gte(statements.period_end, query.periodStart),
        lte(statements.period_start, query.periodEnd),
      ),
    );
  const grouped = new Map<
    string,
    {
      id: string;
      statement_no: string | null;
      direction: 'PAYABLE';
      period_start: string;
      period_end: string;
      paid: boolean;
      items: ItemSnapshot[];
      supply_total: number;
      tax_total: number;
      grand_total: number;
    }
  >();
  for (const { statement, item } of rows) {
    const snapshot = item.snapshot as ItemSnapshot;
    if (snapshot.driver_id !== ctx.user.driver_id) continue;
    let group = grouped.get(statement.id);
    if (!group) {
      const payments = await ctx.db
        .select()
        .from(paymentRecords)
        .where(eq(paymentRecords.statement_id, statement.id));
      group = {
        id: statement.id,
        statement_no: statement.statement_no,
        direction: 'PAYABLE',
        period_start: statement.period_start,
        period_end: statement.period_end,
        paid: payments.some((p) => !p.voided_at),
        items: [],
        supply_total: 0,
        tax_total: 0,
        grand_total: 0,
      };
    }
    group.items.push(snapshot);
    group.supply_total = sumMoney([group.supply_total, item.supply_amount]);
    group.tax_total = sumMoney([group.tax_total, item.tax_amount]);
    group.grand_total = sumMoney([group.supply_total, group.tax_total]);
    grouped.set(statement.id, group);
  }
  return {
    uses: summaries,
    ...groupDriverUses(summaries),
    summary: {
      total: summaries.length,
      submitted: summaries.filter((u) => u.review_status === 'SUBMITTED').length,
      approved: summaries.filter((u) => u.review_status === 'APPROVED').length,
      held: summaries.reduce((n, u) => n + u.held_count, 0),
      needs_fix: summaries.filter((u) => u.review_status === 'NEEDS_FIX').length,
    },
    statements: [...grouped.values()],
  };
}
