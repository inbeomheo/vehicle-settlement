import { proposedAmountSql } from './charge-amount-sql';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Context } from '../context';
import { calculateTax, sumMoney, type TaxMode } from '../domain/money';
import { ledgerBase } from './ledger';
import { managerOnly } from './admin';
import { dateString } from './schemas';
import { assertProjectAccess } from '../authz';
import type { chargeLines } from '../db/schema';
import { displayUnitPrice, proposedSupply } from '@/shared/charge-amount';
import { routeSummary } from '../domain/route-summary';

const optionalId = z.preprocess((value) => (value === '' ? undefined : value), z.uuid().optional());

export const summaryQuerySchema = z
  .object({
    from: dateString,
    to: dateString,
    include: z.enum(['approved', 'all']).default('approved'),
    project_id: optionalId,
    driver_id: optionalId,
    payee_counterparty_id: optionalId,
    sort: z.enum(['date', 'driver']).default('date'),
  })
  .superRefine((query, ctx) => {
    if (query.from > query.to)
      ctx.addIssue({ code: 'custom', path: ['to'], message: '종료일은 시작일 이후로 선택해 주세요.' });
    const limit = new Date(`${query.from}T00:00:00Z`);
    limit.setUTCFullYear(limit.getUTCFullYear() + 1);
    if (new Date(`${query.to}T00:00:00Z`) >= limit)
      ctx.addIssue({ code: 'custom', path: ['to'], message: '조회 기간은 최대 1년입니다.' });
  });

export type SummaryAmounts = {
  count: number;
  approved_supply: number;
  approved_tax: number;
  pending_supply: number;
  pending_unknown_count: number;
};
export type SummaryCell = SummaryAmounts & { project_id: string; driver_id: string };
export type SummaryProject = SummaryAmounts & {
  id: string;
  name: string;
  reviewers: string[];
  loads: string[];
};
export type SummaryDriver = SummaryProject & { affiliations: string[] };
export type SummaryDetailRow = {
  id: string;
  use_id: string;
  use_date: string;
  project_id: string;
  project_name: string;
  driver_id: string;
  driver_name: string;
  route: string;
  load_tonnage: string | null;
  quantity: string | null;
  unit_price: number | null;
  supply: number | null;
  tax: number | null;
  cargo_desc: string;
  status: 'APPROVED' | 'PENDING';
};
export type SummaryResult = {
  rows: SummaryDetailRow[];
  options: {
    projects: { id: string; name: string }[];
    payees: { id: string; name: string }[];
    drivers: { id: string; name: string }[];
  };
  from: string;
  to: string;
  include: 'approved' | 'all';
  projects: SummaryProject[];
  drivers: SummaryDriver[];
  cells: SummaryCell[];
  totals: SummaryAmounts & { grand_total: number; driver_count: number; project_count: number };
};

const emptyAmounts = (): SummaryAmounts => ({
  count: 0,
  approved_supply: 0,
  approved_tax: 0,
  pending_supply: 0,
  pending_unknown_count: 0,
});
function addAmounts(target: SummaryAmounts, source: SummaryAmounts) {
  target.count += source.count;
  target.approved_supply = sumMoney([target.approved_supply, source.approved_supply]);
  target.approved_tax = sumMoney([target.approved_tax, source.approved_tax]);
  target.pending_supply = sumMoney([target.pending_supply, source.pending_supply]);
  target.pending_unknown_count += source.pending_unknown_count;
}
function safeInteger(value: unknown) {
  const result = Number(value ?? 0);
  if (!Number.isSafeInteger(result)) throw new RangeError('합계 금액 범위를 초과했습니다.');
  return result;
}
type PendingLine = { amount: number | null; tax_mode: TaxMode; charge_type: string };
type UseRow = {
  id: string;
  use_date: string;
  payee_counterparty_id: string;
  payee_name: string;
  cargo_desc: string | null;
  trips: { id: string; origin: string; destination: string; cargo_desc: string | null }[];
  lines: (typeof chargeLines.$inferSelect)[];
  project_id: string;
  driver_id: string;
  project_name: string;
  reviewer_name: string | null;
  load_tonnage: string | null;
  driver_name: string;
  total_amount: string | null;
  approved_tax: string;
  approved_count: number;
  pending_lines: PendingLine[];
  affiliations: string[];
};

export async function getSummary(ctx: Context, raw: unknown): Promise<SummaryResult> {
  // Keep the manager gate before input validation, including direct service calls.
  await managerOnly(ctx);
  const query = summaryQuerySchema.parse(raw);
  if (query.project_id) await assertProjectAccess(ctx, query.project_id);
  // Reuse the ledger's approved PAYABLE calculation and current assignment scope.
  // One statement gives amounts, names and affiliations a consistent DB snapshot.
  const base = await ledgerBase(ctx);
  const result = await ctx.db.execute(sql`
    WITH scoped AS (${base})
    SELECT s.id, s.use_date::text, s.payee_counterparty_id, s.payee_name, s.cargo_desc,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'origin',origin,'destination',destination,'cargo_desc',cargo_desc) ORDER BY seq)
        FROM trips WHERE vehicle_use_id=s.id AND status<>'CANCELED'), '[]'::jsonb) AS trips,
      c.lines,
      s.project_id, s.driver_id, s.project_name, s.driver_name, s.total_amount, s.reviewer_name, s.load_tonnage::text,
      c.approved_tax, c.approved_count, c.pending_lines,
      COALESCE((SELECT jsonb_agg(DISTINCT cp.name ORDER BY cp.name)
        FROM driver_affiliations a JOIN counterparties cp ON cp.id=a.counterparty_id
        WHERE a.driver_id=s.driver_id AND a.valid_from<=s.use_date
          AND (a.valid_to IS NULL OR a.valid_to>=s.use_date)), '[]'::jsonb) AS affiliations
    FROM scoped s
    CROSS JOIN LATERAL (SELECT
      COALESCE(jsonb_agg(to_jsonb(charge_lines) || jsonb_build_object('quantity',quantity::text) ORDER BY created_at,id)
        FILTER (WHERE (line_review_status='APPROVED' AND approved_amount IS NOT NULL) OR line_review_status='PENDING'), '[]'::jsonb) AS lines,
      COALESCE(sum(tax_amount) FILTER (WHERE line_review_status='APPROVED' AND approved_amount IS NOT NULL),0)::text AS approved_tax,
      count(*) FILTER (WHERE line_review_status='APPROVED' AND approved_amount IS NOT NULL)::int AS approved_count,
      COALESCE(jsonb_agg(jsonb_build_object(
        'amount', ${proposedAmountSql},
        'tax_mode',tax_mode,'charge_type',charge_type)) FILTER (WHERE line_review_status='PENDING'), '[]'::jsonb) AS pending_lines
      FROM charge_lines WHERE vehicle_use_id=s.id AND direction='PAYABLE' AND deleted_at IS NULL
    ) c
    WHERE s.use_date>=${query.from}::date AND s.use_date<=${query.to}::date
      AND s.operation_status<>'CANCELED'
      AND (${query.include === 'all'} OR c.approved_count>0)
    ORDER BY s.use_date DESC, s.id
  `);
  const source = result.rows as unknown as UseRow[];
  const choices = (key: 'project' | 'driver' | 'payee') =>
    [
      ...new Map(
        source.map((row) => [
          key === 'payee' ? row.payee_counterparty_id : row[`${key}_id`],
          { id: key === 'payee' ? row.payee_counterparty_id : row[`${key}_id`], name: row[`${key}_name`] },
        ]),
      ).values(),
    ].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const options = { projects: choices('project'), drivers: choices('driver'), payees: choices('payee') };
  const rows: SummaryDetailRow[] = [];
  const projects = new Map<string, SummaryProject>();
  const drivers = new Map<string, SummaryDriver>();
  const cells = new Map<string, SummaryCell>();
  const totals = emptyAmounts();
  for (const row of source) {
    if (query.project_id && row.project_id !== query.project_id) continue;
    if (query.driver_id && row.driver_id !== query.driver_id) continue;
    if (query.payee_counterparty_id && row.payee_counterparty_id !== query.payee_counterparty_id) continue;
    for (const line of row.lines) {
      const approved = line.line_review_status === 'APPROVED';
      if (!approved && query.include !== 'all') continue;
      const supply = approved ? line.approved_amount : proposedSupply(line);
      const trips = line.trip_id ? row.trips.filter((trip) => trip.id === line.trip_id) : row.trips;
      const cargo = [
        ...new Set([row.cargo_desc, ...trips.map((trip) => trip.cargo_desc)].filter(Boolean)),
      ].join(', ');
      rows.push({
        id: line.id,
        use_id: row.id,
        use_date: row.use_date,
        project_id: row.project_id,
        project_name: row.project_name,
        driver_id: row.driver_id,
        driver_name: row.driver_name,
        route: routeSummary(trips) ?? '—',
        load_tonnage: row.load_tonnage,
        quantity: line.quantity,
        unit_price: displayUnitPrice(line, supply),
        supply,
        tax: approved ? line.tax_amount : null,
        cargo_desc: [cargo, line.charge_type === 'BASE' ? null : line.reason || '추가 비용']
          .filter(Boolean)
          .join(' · '),
        status: approved ? 'APPROVED' : 'PENDING',
      });
    }
    const amounts: SummaryAmounts = {
      ...emptyAmounts(),
      count: 1,
      approved_supply: safeInteger(row.total_amount),
      approved_tax: safeInteger(row.approved_tax),
    };
    if (query.include === 'all') {
      for (const line of row.pending_lines) {
        if (line.amount === null) amounts.pending_unknown_count += 1;
        else
          amounts.pending_supply = sumMoney([
            amounts.pending_supply,
            line.charge_type === 'ADJUSTMENT' ? line.amount : calculateTax(line.amount, line.tax_mode).supply,
          ]);
      }
    }
    const project = projects.get(row.project_id) ?? {
      ...emptyAmounts(),
      id: row.project_id,
      name: row.project_name,
      reviewers: [],
      loads: [],
    };
    const driver = drivers.get(row.driver_id) ?? {
      ...emptyAmounts(),
      id: row.driver_id,
      name: row.driver_name,
      reviewers: [],
      loads: [],
      affiliations: [],
    };
    for (const group of [project, driver]) {
      group.reviewers = [...new Set([...group.reviewers, row.reviewer_name ?? '미지정'])];
      group.loads = [...new Set([...group.loads, ...(row.load_tonnage ? [row.load_tonnage] : [])])];
    }
    driver.affiliations = [...new Set([...driver.affiliations, ...row.affiliations])].sort((a, b) =>
      a.localeCompare(b, 'ko'),
    );
    const key = `${row.project_id}:${row.driver_id}`;
    const cell = cells.get(key) ?? {
      ...emptyAmounts(),
      project_id: row.project_id,
      driver_id: row.driver_id,
    };
    for (const target of [project, driver, cell, totals]) addAmounts(target, amounts);
    projects.set(project.id, project);
    drivers.set(driver.id, driver);
    cells.set(key, cell);
  }
  const byAmount = (a: SummaryProject, b: SummaryProject) =>
    b.approved_supply - a.approved_supply || a.name.localeCompare(b.name, 'ko') || a.id.localeCompare(b.id);
  return {
    ...query,
    options,
    rows: rows.sort(
      (a, b) =>
        (query.sort === 'driver' ? a.driver_name.localeCompare(b.driver_name, 'ko') : 0) ||
        a.use_date.localeCompare(b.use_date) ||
        a.use_id.localeCompare(b.use_id) ||
        a.id.localeCompare(b.id),
    ),
    projects: [...projects.values()].sort(byAmount),
    drivers: [...drivers.values()].sort(byAmount),
    cells: [...cells.values()],
    totals: {
      ...totals,
      grand_total: sumMoney([totals.approved_supply, totals.approved_tax]),
      driver_count: drivers.size,
      project_count: projects.size,
    },
  };
}
