import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { Context } from '../context';
import { accessibleUseFilter, assertActive } from '../authz';
import { chargeLines, paymentRecords, statementItems, statements, vehicleUses } from '../db/schema';
import { sumMoney } from '../domain/money';
import { notFound } from '../errors';
import { driverSettlementSchema } from './statements-schemas';
import type { ItemSnapshot } from './statements';
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
  const summaries = [];
  for (const use of uses) {
    const lines = await ctx.db
      .select()
      .from(chargeLines)
      .where(and(eq(chargeLines.vehicle_use_id, use.id), eq(chargeLines.direction, 'PAYABLE')));
    summaries.push({
      id: use.id,
      use_no: use.use_no,
      use_date: use.use_date,
      review_status: use.review_status,
      project_name: String(use.snapshot?.project_name ?? ''),
      held_count: lines.filter((l) => !l.deleted_at && l.line_review_status === 'HELD').length,
      approved_supply: sumMoney(
        lines
          .filter((l) => !l.deleted_at && l.line_review_status === 'APPROVED')
          .map((l) => l.approved_amount),
      ),
    });
  }
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
