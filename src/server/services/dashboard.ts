import { sql } from 'drizzle-orm';
import type { Context } from '../context';
import { accessibleProjectIds } from '../authz';
import { ledgerBase } from './ledger';

export async function getDashboard(ctx: Context) {
  const base = await ledgerBase(ctx);
  const ids = await accessibleProjectIds(ctx);
  // Statements are indivisible. Scoped managers only see totals when every included project is accessible.
  const statementScope =
    ids === null
      ? sql`true`
      : ids.length
        ? sql`EXISTS (SELECT 1 FROM statement_items si WHERE si.statement_id=s.id AND si.inclusion='INCLUDED') AND NOT EXISTS (
    SELECT 1 FROM statement_items si JOIN charge_lines cl ON cl.id=si.charge_line_id JOIN vehicle_uses vu ON vu.id=cl.vehicle_use_id
    WHERE si.statement_id=s.id AND si.inclusion='INCLUDED' AND vu.project_id NOT IN (${sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`,`,
    )}))`
        : sql`false`;
  const result = await ctx.db.execute(sql`WITH scoped AS (${base}), unpaid AS (
    SELECT s.id,s.grand_total FROM statements s WHERE s.direction='PAYABLE' AND s.status='CONFIRMED' AND ${statementScope}
      AND NOT EXISTS (SELECT 1 FROM payment_records pr WHERE pr.statement_id=s.id AND pr.voided_at IS NULL)
  ) SELECT
    (SELECT count(*)::int FROM scoped WHERE review_status='SUBMITTED' AND operation_status<>'CANCELED' AND (reviewer_user_id=${ctx.user.id}::uuid OR reviewer_user_id IS NULL)) AS review_pending,
    (SELECT count(*)::int FROM scoped WHERE review_status='NEEDS_FIX' AND operation_status<>'CANCELED') AS fix_pending,
    (SELECT count(*)::int FROM scoped WHERE evidence_missing AND operation_status<>'CANCELED') AS evidence_missing,
    (SELECT COALESCE(sum(cl.approved_amount),0)::text FROM charge_lines cl JOIN scoped ON scoped.id=cl.vehicle_use_id
      WHERE scoped.review_status='APPROVED' AND scoped.operation_status<>'CANCELED' AND cl.direction='PAYABLE' AND cl.line_review_status='APPROVED' AND cl.deleted_at IS NULL AND cl.locked_statement_id IS NULL) AS unsettled_approved_amount,
    (SELECT count(*)::int FROM unpaid) AS unpaid_count,
    (SELECT COALESCE(sum(grand_total),0)::text FROM unpaid) AS unpaid_amount`);
  const row = result.rows[0];
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      const number = Number(value);
      if (!Number.isSafeInteger(number)) throw new RangeError('합계 범위를 초과했습니다.');
      return [key, number];
    }),
  );
}
