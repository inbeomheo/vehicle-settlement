import { reviewSupplySql } from './charge-amount-sql';
import { sumMoney } from '../domain/money';
import { formatQuantity } from '../../shared/quantity';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Context } from '../context';
import { accessibleUseFilter } from '../authz';
import { managerOnly } from './admin';
import { dateString, uuid } from './schemas';

export const ledgerQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1000000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    from: dateString.optional(),
    to: dateString.optional(),
    period: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional(),
    project_id: uuid.optional(),
    driver_id: uuid.optional(),
    reviewer_user_id: uuid.optional(),
    transport_search: z.string().trim().max(100).optional(),
    exclude_canceled: z.enum(['true']).optional(),
    reviewer_name: z.string().trim().max(100).optional(),
    reviewer_scope: z.enum(['mine', 'all', 'auto']).default('all'),
    load_tonnage: z
      .string()
      .regex(/^\d{1,7}(\.\d{1,3})?$/)
      .optional(),
    vehicle_id: uuid.optional(),
    counterparty_id: uuid.optional(),
    use_id: uuid.optional(),
    review_status: z.enum(['DRAFT', 'SUBMITTED', 'NEEDS_FIX', 'APPROVED']).optional(),
    settlement_status: z.enum(['UNSETTLED', 'PARTIAL', 'SETTLED']).optional(),
    payment_status: z.enum(['UNPAID', 'PARTIAL', 'PAID', 'NOT_SETTLED']).optional(),
    evidence_missing: z.enum(['true', 'false']).optional(),
    unsettled_approved: z.enum(['true']).optional(),
    search: z.string().trim().max(100).optional(),
    sort: z.enum(['use_date', 'use_no', 'total_amount', 'project_name', 'driver_name']).default('use_date'),
    order: z.enum(['asc', 'desc']).default('desc'),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: '사용일 종료일을 확인하세요.',
    path: ['to'],
  });
export type LedgerRow = {
  id: string;
  use_no: string;
  use_date: string;
  project_id: string;
  driver_id: string;
  vehicle_id: string;
  project_name: string;
  driver_name: string;
  reviewer_user_id: string | null;
  reviewer_name: string | null;
  load_tonnage: string | null;
  plate_no: string;
  vehicle_type: string;
  tonnage: string;
  payee_name: string;
  work_type_name: string | null;
  requester: string | null;
  cargo_desc: string | null;
  creator_name: string;
  actor_names: Record<string, string>;
  route_summary: string;
  trip_details: {
    origin: string;
    destination: string;
    status: string;
    quantity: string | null;
    quantity_unit: string | null;
  }[];
  review_base_amount: number | null;
  review_extra_amount: number | null;
  review_total_amount: number | null;
  has_requested_extra: boolean;
  has_base_amount_difference: boolean;
  origin: string | null;
  destination: string | null;
  billing_units: string[];
  performance: string | null;
  base_amount: number | null;
  extra_amount: number | null;
  total_amount: number | null;
  receivable_amount: number | null;
  evidence_count: number;
  evidence_missing: boolean;
  review_status: string;
  operation_status: string;
  entered_as: string;
  settlement_status: string;
  payment_status: string;
  statement_numbers: string | null;
  locked_statements: {
    id: string;
    statement_no: string | null;
    direction: string;
    period_start: string;
    period_end: string;
  }[];
};
export type LedgerResult = {
  rows: LedgerRow[];
  page: number;
  pageSize: number;
  total: number;
  reviewer_scope?: 'mine' | 'all';
  totals: { pageSum: number; filteredSum: number };
};
// One shared predicate matches W1's submission policy, including replaced/deleted/upload-failed evidence.
export const missingEvidenceSql = sql`(p.evidence_policy <> 'NONE' AND NOT EXISTS (
  SELECT 1 FROM evidence e WHERE e.vehicle_use_id=vehicle_uses.id AND e.deleted_at IS NULL AND e.replaced_by_id IS NULL AND e.upload_status='UPLOADED'
  AND ((e.storage_key IS NOT NULL AND e.kind IN ('PHOTO','RECEIPT','WEIGH_TICKET','CONFIRMATION'))
    OR (p.evidence_policy='PHOTO_OR_ALTERNATIVE' AND e.kind IN ('SLIP_NO','CONFIRMATION') AND length(trim(e.text_value)) > 0))
))`;
export async function ledgerBase(ctx: Context) {
  await managerOnly(ctx);
  const scope = await accessibleUseFilter(ctx);
  return sql`SELECT vehicle_uses.*, vehicle_uses.snapshot->>'project_name' AS project_name,
    vehicle_uses.snapshot->>'driver_name' AS driver_name, vehicle_uses.snapshot->>'plate_no' AS plate_no,
    vehicle_uses.snapshot->>'vehicle_type' AS vehicle_type, vehicle_uses.snapshot->>'tonnage' AS tonnage,
    vehicle_uses.snapshot->>'payee_name' AS payee_name, w.name AS work_type_name, u.name AS creator_name,
    COALESCE(reviewer.name, vehicle_uses.snapshot->>'reviewer_name') AS reviewer_name,
    (SELECT COALESCE(jsonb_object_agg(actor.id::text,actor.name),'{}'::jsonb) FROM users actor
      WHERE actor.id=vehicle_uses.created_by_user_id OR EXISTS (SELECT 1 FROM use_revisions r
        WHERE r.vehicle_use_id=vehicle_uses.id AND (r.submitted_by=actor.id OR r.decided_by=actor.id))) AS actor_names,
    t.origin, t.destination, t.performance, t.trip_details, c.review_base_amount, c.review_extra_amount, COALESCE(c.has_requested_extra,false) AS has_requested_extra, COALESCE(c.has_base_amount_difference,false) AS has_base_amount_difference, c.billing_units, c.base_amount, c.extra_amount, c.total_amount, c.receivable_amount,
    COALESCE(e.evidence_count,0)::int AS evidence_count, ${missingEvidenceSql} AS evidence_missing,
    CASE WHEN c.payable_count=0 OR c.locked_count=0 THEN 'UNSETTLED' WHEN c.locked_count=c.payable_count THEN 'SETTLED' ELSE 'PARTIAL' END AS settlement_status,
    CASE WHEN c.locked_count=0 THEN 'NOT_SETTLED' WHEN c.paid_count=0 THEN 'UNPAID' WHEN c.paid_count=c.locked_count THEN 'PAID' ELSE 'PARTIAL' END AS payment_status,
    c.unsettled_approved, st.statement_numbers, COALESCE(st.locked_statements,'[]'::jsonb) AS locked_statements
    FROM vehicle_uses
    JOIN projects p ON p.id=vehicle_uses.project_id
    JOIN users u ON u.id=vehicle_uses.created_by_user_id
    LEFT JOIN users reviewer ON reviewer.id=vehicle_uses.reviewer_user_id
    LEFT JOIN work_types w ON w.id=vehicle_uses.work_type_id
    LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('origin',origin,'destination',destination,'status',status,'quantity',quantity::text,'quantity_unit',quantity_unit) ORDER BY seq) AS trip_details, string_agg(origin,' / ' ORDER BY seq) AS origin, string_agg(destination,' / ' ORDER BY seq) AS destination,
      count(*) FILTER (WHERE status='COMPLETED')::text || '회 운행' || COALESCE(' · ' || string_agg(CASE WHEN quantity IS NOT NULL THEN quantity::text || COALESCE(quantity_unit,'') END, ' / ' ORDER BY seq),'') AS performance
      FROM trips WHERE vehicle_use_id=vehicle_uses.id) t ON true
    LEFT JOIN LATERAL (SELECT count(*) AS evidence_count FROM evidence WHERE vehicle_use_id=vehicle_uses.id AND deleted_at IS NULL AND replaced_by_id IS NULL AND upload_status='UPLOADED') e ON true
    LEFT JOIN LATERAL (SELECT
      CASE WHEN bool_or(direction='PAYABLE' AND charge_type='BASE' AND line_review_status<>'REJECTED' AND ${reviewSupplySql} IS NULL) THEN NULL ELSE sum(${reviewSupplySql}) FILTER (WHERE direction='PAYABLE' AND charge_type='BASE' AND line_review_status<>'REJECTED') END AS review_base_amount,
      CASE WHEN bool_or(direction='PAYABLE' AND charge_type<>'BASE' AND line_review_status<>'REJECTED' AND ${reviewSupplySql} IS NULL) THEN NULL ELSE COALESCE(sum(${reviewSupplySql}) FILTER (WHERE direction='PAYABLE' AND charge_type<>'BASE' AND line_review_status<>'REJECTED'),0) END AS review_extra_amount,
      bool_or(direction='PAYABLE' AND charge_type<>'BASE' AND requested_amount IS NOT NULL AND line_review_status='PENDING') AS has_requested_extra,
      bool_or(direction='PAYABLE' AND charge_type='BASE' AND line_review_status='PENDING' AND COALESCE((agreement_snapshot->>'contract_computed_amount')::integer,computed_amount) IS NOT NULL AND COALESCE(requested_amount,computed_amount) IS NOT NULL AND COALESCE((agreement_snapshot->>'contract_computed_amount')::integer,computed_amount)<>COALESCE(requested_amount,computed_amount)) AS has_base_amount_difference,
      array_agg(DISTINCT billing_unit::text) FILTER (WHERE direction='PAYABLE') AS billing_units,
      sum(approved_amount) FILTER (WHERE direction='PAYABLE' AND line_review_status='APPROVED' AND charge_type='BASE') AS base_amount,
      sum(approved_amount) FILTER (WHERE direction='PAYABLE' AND line_review_status='APPROVED' AND charge_type<>'BASE') AS extra_amount,
      sum(approved_amount) FILTER (WHERE direction='PAYABLE' AND line_review_status='APPROVED') AS total_amount,
      sum(approved_amount) FILTER (WHERE direction='RECEIVABLE' AND line_review_status='APPROVED') AS receivable_amount,
      count(*) FILTER (WHERE direction='PAYABLE' AND line_review_status<>'REJECTED') AS payable_count,
      count(*) FILTER (WHERE direction='PAYABLE' AND locked_statement_id IS NOT NULL) AS locked_count,
      count(*) FILTER (WHERE direction='PAYABLE' AND locked_statement_id IS NOT NULL AND EXISTS (SELECT 1 FROM payment_records pr WHERE pr.statement_id=locked_statement_id AND pr.voided_at IS NULL)) AS paid_count,
      bool_or(direction='PAYABLE' AND line_review_status='APPROVED' AND approved_amount IS NOT NULL AND locked_statement_id IS NULL AND vehicle_uses.review_status='APPROVED') AS unsettled_approved
      FROM charge_lines WHERE vehicle_use_id=vehicle_uses.id AND deleted_at IS NULL) c ON true
    LEFT JOIN LATERAL (SELECT string_agg(s.statement_no, ', ' ORDER BY s.statement_no) AS statement_numbers,
      jsonb_agg(jsonb_build_object('id',s.id,'statement_no',s.statement_no,'direction',s.direction,'period_start',s.period_start,'period_end',s.period_end) ORDER BY s.period_start,s.id) AS locked_statements
      FROM statements s WHERE s.status='CONFIRMED' AND EXISTS (SELECT 1 FROM charge_lines cl WHERE cl.vehicle_use_id=vehicle_uses.id AND cl.deleted_at IS NULL AND cl.locked_statement_id=s.id)) st ON true
    WHERE ${scope ?? sql`true`}`;
}
export async function getLedger(ctx: Context, raw: unknown, exportAll = false): Promise<LedgerResult> {
  const q = ledgerQuerySchema.parse(raw);
  const base = await ledgerBase(ctx);
  const clauses: SQL[] = [sql`true`];
  for (const key of [
    'project_id',
    'driver_id',
    'reviewer_user_id',
    'vehicle_id',
    'review_status',
    'settlement_status',
    'payment_status',
  ] as const) {
    if (q[key]) clauses.push(sql`${sql.identifier(key)}=${q[key]}`);
  }
  if (q.exclude_canceled) clauses.push(sql`operation_status<>'CANCELED'`);
  if (q.transport_search)
    clauses.push(
      sql`(cargo_desc ILIKE ${'%' + q.transport_search.replace(/[\\%_]/g, '\\$&') + '%'} OR EXISTS (SELECT 1 FROM trips WHERE vehicle_use_id=enriched.id AND concat_ws(' ',origin,destination,cargo_desc) ILIKE ${'%' + q.transport_search.replace(/[\\%_]/g, '\\$&') + '%'}))`,
    );
  if (q.reviewer_name)
    clauses.push(sql`reviewer_name ILIKE ${'%' + q.reviewer_name.replace(/[\\%_]/g, '\\$&') + '%'}`);
  if (q.load_tonnage) clauses.push(sql`load_tonnage=${q.load_tonnage}::numeric`);
  if (q.use_id) clauses.push(sql`id=${q.use_id}::uuid`);
  if (q.counterparty_id) clauses.push(sql`payee_counterparty_id=${q.counterparty_id}::uuid`);
  if (q.from) clauses.push(sql`use_date>=${q.from}::date`);
  if (q.to) clauses.push(sql`use_date<=${q.to}::date`);
  if (q.evidence_missing)
    clauses.push(sql`evidence_missing=${q.evidence_missing === 'true'} AND operation_status<>'CANCELED'`);
  if (q.unsettled_approved) clauses.push(sql`unsettled_approved=true AND operation_status<>'CANCELED'`);
  if (q.period)
    clauses.push(sql`EXISTS (SELECT 1 FROM statement_items si JOIN statements s ON s.id=si.statement_id JOIN charge_lines cl ON cl.id=si.charge_line_id
    WHERE cl.vehicle_use_id=enriched.id AND si.inclusion='INCLUDED' AND s.status<>'CANCELED'
      AND s.period_start < (${q.period + '-01'}::date + interval '1 month') AND s.period_end >= ${q.period + '-01'}::date)`);
  if (q.search)
    clauses.push(
      sql`concat_ws(' ',use_no,project_name,driver_name,plate_no,payee_name,cargo_desc,requester,origin,destination) ILIKE ${'%' + q.search.replace(/[\\%_]/g, '\\$&') + '%'}`,
    );
  let reviewerScope: 'mine' | 'all' = q.reviewer_scope === 'mine' ? 'mine' : 'all';
  const mine = sql`(reviewer_user_id=${ctx.user.id}::uuid OR reviewer_user_id IS NULL)`;
  if (q.reviewer_scope === 'auto') {
    const count = await ctx.db.execute(
      sql`WITH enriched AS (${base}) SELECT count(*)::int AS n FROM enriched WHERE ${sql.join(clauses, sql` AND `)} AND ${mine}`,
    );
    reviewerScope = Number(count.rows[0].n) > 0 ? 'mine' : 'all';
  }
  if (reviewerScope === 'mine') clauses.push(mine);
  const order = sql`${sql.identifier(q.sort)} ${q.order === 'asc' ? sql`ASC` : sql`DESC`} NULLS LAST, id ASC`;
  const result = await ctx.db
    .execute(sql`WITH enriched AS (${base}), filtered AS (SELECT * FROM enriched WHERE ${sql.join(clauses, sql` AND `)}),
    paged AS (SELECT * FROM filtered ORDER BY ${order} ${exportAll ? sql`` : sql`LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`})
    SELECT COALESCE((SELECT jsonb_agg(to_jsonb(paged) ORDER BY ${order}) FROM paged),'[]'::jsonb) AS rows,
      (SELECT count(*)::int FROM filtered) AS total,
      (SELECT COALESCE(sum(total_amount) FILTER (WHERE operation_status<>'CANCELED'),0)::text FROM paged) AS page_sum,
      (SELECT COALESCE(sum(total_amount) FILTER (WHERE operation_status<>'CANCELED'),0)::text FROM filtered) AS filtered_sum`);
  const resultRow = result.rows[0];
  const safeMoney = (value: unknown) => {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new RangeError('합계 금액 범위를 초과했습니다.');
    return number;
  };
  const rows = resultRow.rows as LedgerRow[];
  for (const row of rows) {
    if (row.load_tonnage !== null) row.load_tonnage = String(row.load_tonnage);
    const details = row.trip_details ?? [];
    const routes = [...new Set(details.map((trip) => `${trip.origin} → ${trip.destination}`))];
    row.route_summary = routes.length
      ? `${routes[0]}${details.length > 1 ? ` 외 ${details.length - 1}회` : ''}`
      : '경로 미입력';
    row.performance =
      `${details.filter((trip) => trip.status === 'COMPLETED').length}회 운행` +
      details
        .filter((trip) => trip.quantity !== null)
        .map((trip) => ` · ${formatQuantity(trip.quantity)}${trip.quantity_unit ?? ''}`)
        .join('');
    for (const key of [
      'base_amount',
      'extra_amount',
      'total_amount',
      'receivable_amount',
      'review_base_amount',
      'review_extra_amount',
    ] as const)
      if (row[key] !== null) row[key] = safeMoney(row[key]);
    row.review_total_amount =
      row.review_base_amount === null || row.review_extra_amount === null
        ? null
        : sumMoney([row.review_base_amount, row.review_extra_amount]);
  }
  return {
    rows,
    reviewer_scope: reviewerScope,
    page: exportAll ? 1 : q.page,
    pageSize: exportAll ? rows.length : q.pageSize,
    total: Number(resultRow.total),
    totals: { pageSum: safeMoney(resultRow.page_sum), filteredSum: safeMoney(resultRow.filtered_sum) },
  };
}
