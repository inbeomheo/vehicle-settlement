import { sql } from 'drizzle-orm';

// SQL equivalent of shared/charge-amount; keep parity covered by PRICE integration tests.
export const proposedAmountSql = sql`CASE WHEN included_in_base THEN 0
  WHEN charge_type='BASE' THEN COALESCE(requested_amount,computed_amount)
  ELSE COALESCE(computed_amount,requested_amount) END`;
export const proposedSupplySql = sql`CASE WHEN charge_type<>'ADJUSTMENT' AND tax_mode='VAT_INCLUDED'
  THEN round((${proposedAmountSql})::numeric / 1.1) ELSE ${proposedAmountSql} END`;
export const reviewSupplySql = sql`COALESCE(approved_amount,${proposedSupplySql})`;
