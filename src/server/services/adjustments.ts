import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Context } from '../context';
import { todaySeoul } from '../context';
import { audit } from '../audit';
import { chargeLines, paymentRecords, statementItems } from '../db/schema';
import { taxFromSupply } from '../domain/money';
import { invalid } from '../errors';
import { atomic, rawUse } from './uses';
import { rawStatement } from './statements';
import { adjustmentSchema } from './statements-schemas';
export async function createAdjustment(ctx: Context, input: z.input<typeof adjustmentSchema>) {
  const data = adjustmentSchema.parse(input);
  return atomic(ctx, async (tx) => {
    const statement = await rawStatement(tx, data.adjusts_statement_id, true);
    if (statement.status !== 'CONFIRMED') invalid('확정된 지급·입금 완료 명세만 조정할 수 있습니다.');
    const [payment] = await tx.db
      .select()
      .from(paymentRecords)
      .where(and(eq(paymentRecords.statement_id, statement.id), isNull(paymentRecords.voided_at)));
    if (!payment) invalid('지급·입금 완료 명세만 조정할 수 있습니다.');
    const [original] = await tx.db
      .select({ line: chargeLines })
      .from(statementItems)
      .innerJoin(chargeLines, eq(chargeLines.id, statementItems.charge_line_id))
      .where(
        and(
          eq(statementItems.statement_id, statement.id),
          eq(statementItems.inclusion, 'INCLUDED'),
          eq(statementItems.charge_line_id, data.charge_line_id),
        ),
      );
    if (!original) invalid('원명세에 포함된 항목을 선택하세요.');
    const use = await rawUse(tx, original.line.vehicle_use_id, true);
    const nextDay = new Date(`${statement.period_end}T00:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const earliest = nextDay.toISOString().slice(0, 10);
    const effective = data.effective_date ?? (todaySeoul() > earliest ? todaySeoul() : earliest);
    if (effective < earliest) invalid('조정은 원명세 정산 기간 이후에 반영해야 합니다.');
    const [line] = await tx.db
      .insert(chargeLines)
      .values({
        vehicle_use_id: use.id,
        direction: statement.direction,
        counterparty_id: statement.counterparty_id,
        charge_type: 'ADJUSTMENT',
        billing_unit: 'LUMP_SUM',
        quantity: '1',
        unit_price: data.supply_amount,
        rate_basis_date: effective,
        tax_mode: original.line.tax_mode,
        rounding: original.line.rounding,
        computed_amount: data.supply_amount,
        approved_amount: data.supply_amount,
        tax_amount: taxFromSupply(data.supply_amount, original.line.tax_mode),
        price_status: 'CONFIRMED',
        line_review_status: 'APPROVED',
        reason: data.reason,
        adjusts_statement_id: statement.id,
        agreement_snapshot: {
          original_charge_line_id: original.line.id,
          statement_no: statement.statement_no,
          reason: data.reason,
          effective_date: effective,
        },
      })
      .returning();
    await audit(tx, 'ADJUSTMENT_CREATE', 'charge_line', line.id, null, line, data.reason);
    return line;
  });
}
