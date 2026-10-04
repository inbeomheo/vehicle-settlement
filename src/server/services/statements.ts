import { proposedSupply } from '../../shared/charge-amount';
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Context } from '../context';
import { todaySeoul } from '../context';
import { accessibleProjectIds, accessibleUseFilter, assertCanReadUse, assertCanSettle } from '../authz';
import { audit } from '../audit';
import {
  auditLogs,
  chargeLines,
  companySettings,
  counterparties,
  paymentRecords,
  statementItems,
  statements,
  trips,
  vehicleUses,
} from '../db/schema';
import { nextStatementNo } from '../db/numbers';
import { sumMoney, won, type TaxMode, type Rounding } from '../domain/money';
import { AppError, invalid, notFound } from '../errors';
import {
  assertEvidenceSatisfied,
  atomic,
  missingChargeQuantity,
  chargeQuantityMessage,
  type Charge,
  type Use,
} from './uses';
import { uuid } from './schemas';
import {
  cancelStatementSchema,
  candidateSchema,
  confirmStatementSchema,
  createStatementSchema,
  statementListSchema,
  updateStatementSchema,
} from './statements-schemas';

export type Statement = typeof statements.$inferSelect;
export type Item = typeof statementItems.$inferSelect;
export type StatementItem = Item & { eligible?: boolean; reasons?: string[]; line_version?: number };
export type ItemSnapshot = {
  vehicle_use_id: string;
  project_id: string;
  driver_id: string;
  use_no: string;
  use_date: string;
  project_name: string;
  plate_no: string;
  driver_name: string;
  cargo_desc: string;
  trip_count: number;
  billing_unit: string;
  quantity: string | null;
  unit_price: number | null;
  computed_amount?: number | null;
  tax_mode?: TaxMode;
  rounding?: Rounding;
  supply_amount: number | null;
  tax_amount: number | null;
  notes: string;
  carried_forward: boolean;
  charge_type?: string;
  adjusts_statement_id: string | null;
};
export function statementVersion(statement: Statement, version: number) {
  if (statement.version !== version)
    throw new AppError('VERSION_CONFLICT', '다른 사용자가 수정했습니다. 새로고침 후 확인하세요.', {
      current_version: statement.version,
    });
}
export async function settlementAccess(ctx: Context) {
  await accessibleProjectIds(ctx);
  if (!['ADMIN', 'SETTLEMENT_MANAGER'].includes(ctx.user.role)) notFound();
  await assertCanSettle(ctx);
}
export async function rawStatement(ctx: Context, id: string, lock = false) {
  uuid.parse(id);
  await settlementAccess(ctx);
  const query = ctx.db.select().from(statements).where(eq(statements.id, id));
  const [statement] = await (lock ? query.for('update') : query);
  if (!statement) notFound();
  const scope = await accessibleProjectIds(ctx);
  const rows = await ctx.db
    .select({ item: statementItems, use: vehicleUses })
    .from(statementItems)
    .innerJoin(chargeLines, eq(chargeLines.id, statementItems.charge_line_id))
    .innerJoin(vehicleUses, eq(vehicleUses.id, chargeLines.vehicle_use_id))
    .where(eq(statementItems.statement_id, id));
  if (scope) {
    if (!rows.length && statement.created_by !== ctx.user.id) notFound();
    for (const row of rows) {
      const projectId =
        statement.status === 'DRAFT'
          ? row.use.project_id
          : String(row.item.snapshot?.project_id ?? row.use.project_id);
      if (!scope.includes(projectId)) notFound();
    }
  }
  return statement;
}
export async function makeItemSnapshot(
  ctx: Context,
  line: Charge,
  use: Use,
  periodStart: string,
): Promise<ItemSnapshot> {
  const [count] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(trips)
    .where(and(eq(trips.vehicle_use_id, use.id), eq(trips.status, 'COMPLETED')));
  return {
    vehicle_use_id: use.id,
    project_id: use.project_id,
    driver_id: use.driver_id,
    use_no: use.use_no,
    use_date: use.use_date,
    project_name: String(use.snapshot?.project_name ?? ''),
    plate_no: String(use.snapshot?.plate_no ?? ''),
    driver_name: String(use.snapshot?.driver_name ?? ''),
    cargo_desc: use.cargo_desc ?? '',
    trip_count: count.n,
    billing_unit: line.billing_unit,
    quantity: line.quantity,
    unit_price: line.unit_price,
    computed_amount: line.computed_amount,
    tax_mode: line.tax_mode,
    rounding: line.rounding,
    supply_amount: line.approved_amount,
    tax_amount: line.tax_amount,
    notes: [use.notes, line.reason].filter(Boolean).join(' / '),
    carried_forward: use.use_date < periodStart,
    charge_type: line.charge_type,
    adjusts_statement_id: line.adjusts_statement_id,
  };
}
export async function eligibilityReasons(
  ctx: Context,
  line: Charge,
  use: Use,
  statement: Pick<Statement, 'direction' | 'counterparty_id' | 'period_end'>,
) {
  const reasons: string[] = [];
  if (missingChargeQuantity(line)) reasons.push(chargeQuantityMessage(line));
  if (use.operation_status === 'CANCELED') reasons.push('취소된 사용 건');
  if (use.review_status === 'DRAFT' || use.current_revision_no === 0) reasons.push('미제출 사용 건');
  if (use.review_status !== 'APPROVED') reasons.push('사용 건 미승인');
  if (line.line_review_status !== 'APPROVED')
    reasons.push(line.line_review_status === 'HELD' ? '라인 보류' : '비용 라인 미승인');
  if (line.price_status !== 'CONFIRMED') reasons.push('단가 미확정');
  if (line.approved_amount === null) reasons.push('승인액 없음');
  if (line.tax_amount === null) reasons.push('세액 미확정');
  if (line.direction !== statement.direction || line.counterparty_id !== statement.counterparty_id)
    reasons.push('방향 또는 거래처 불일치');
  if (line.locked_statement_id) reasons.push('다른 확정 명세에 포함됨');
  if (line.deleted_at) reasons.push('삭제된 비용');
  if (
    use.use_date > statement.period_end ||
    (line.charge_type === 'ADJUSTMENT' && line.rate_basis_date > statement.period_end)
  )
    reasons.push('정산 기간 종료일 이후 항목');
  try {
    await assertEvidenceSatisfied(ctx, use);
  } catch (error) {
    if (error instanceof AppError && error.code === 'SUBMIT_BLOCKED') reasons.push('필수증빙 미충족');
    else throw error;
  }
  return reasons;
}
export async function statementCandidates(ctx: Context, input: z.input<typeof candidateSchema>) {
  const query = candidateSchema.parse(input);
  await settlementAccess(ctx);
  if (query.statementId) await rawStatement(ctx, query.statementId);
  const rows = await ctx.db
    .select({ line: chargeLines, use: vehicleUses })
    .from(chargeLines)
    .innerJoin(vehicleUses, eq(vehicleUses.id, chargeLines.vehicle_use_id))
    .where(
      and(
        await accessibleUseFilter(ctx),
        eq(chargeLines.direction, query.direction),
        eq(chargeLines.counterparty_id, query.counterpartyId),
        isNull(chargeLines.locked_statement_id),
        isNull(chargeLines.deleted_at),
        ne(vehicleUses.operation_status, 'CANCELED'),
        lte(vehicleUses.use_date, query.periodEnd),
        sql`(${chargeLines.charge_type} <> 'ADJUSTMENT' OR ${chargeLines.rate_basis_date} <= ${query.periodEnd})`,
      ),
    )
    .orderBy(asc(vehicleUses.use_date), asc(vehicleUses.use_no), asc(chargeLines.id));
  const candidates = [];
  const unsubmitted = new Set<string>();
  for (const { line, use } of rows) {
    const isUnsubmitted = use.review_status === 'DRAFT' || use.current_revision_no === 0;
    if (isUnsubmitted) {
      unsubmitted.add(use.id);
      if (query.includeDrafts !== 'true') continue;
    }
    const reasons = await eligibilityReasons(ctx, line, use, {
      direction: query.direction,
      counterparty_id: query.counterpartyId,
      period_end: query.periodEnd,
    });
    const drafts = await ctx.db
      .select({ id: statements.id })
      .from(statementItems)
      .innerJoin(statements, eq(statements.id, statementItems.statement_id))
      .where(
        and(
          eq(statementItems.charge_line_id, line.id),
          eq(statementItems.inclusion, 'INCLUDED'),
          eq(statements.status, 'DRAFT'),
          query.statementId ? ne(statements.id, query.statementId) : undefined,
        ),
      );
    if (drafts.length) reasons.push('다른 초안에 포함 중');
    candidates.push({
      charge_line_id: line.id,
      snapshot: await makeItemSnapshot(ctx, line, use, query.periodStart),
      estimated_supply: line.approved_amount ?? proposedSupply(line),
      eligible: !reasons.length,
      reasons,
    });
  }
  return { rows: candidates, total: candidates.length, unsubmitted_count: unsubmitted.size };
}
async function headerSnapshots(ctx: Context, statement: Pick<Statement, 'counterparty_id'>) {
  const [party] = await ctx.db
    .select()
    .from(counterparties)
    .where(eq(counterparties.id, statement.counterparty_id));
  if (!party) notFound();
  const [company] = await ctx.db.select().from(companySettings).limit(1);
  return {
    counterparty_snapshot: {
      name: party.name,
      representative_name: party.representative_name,
      address: party.address,
      business_type: party.business_type,
      business_item: party.business_item,
      biz_no: party.biz_no,
      contact_name: party.contact_name,
      phone: party.phone,
      bank_account: party.bank_account,
    },
    issuer_snapshot: {
      name: company?.name ?? '회사 정보 미등록',
      biz_no: company?.biz_no ?? '',
      address: company?.address ?? '',
      representative: company?.representative ?? '',
      business_type: company?.business_type ?? '',
      business_item: company?.business_item ?? '',
      settlement_contact: company?.settlement_contact ?? '',
      prepared_by: ctx.user.name,
      issued_on: todaySeoul(),
    },
  };
}
export function itemTotals(
  items: (Pick<Item, 'inclusion' | 'supply_amount' | 'tax_amount'> & { eligible?: boolean })[],
) {
  const included = items.filter(
    (item) =>
      item.inclusion === 'INCLUDED' &&
      item.eligible !== false &&
      item.supply_amount !== null &&
      item.tax_amount !== null,
  );
  const supply_total = won(sumMoney(included.map((i) => i.supply_amount)));
  const tax_total = won(sumMoney(included.map((i) => i.tax_amount)));
  return { supply_total, tax_total, grand_total: won(sumMoney([supply_total, tax_total])) };
}
async function liveItems(ctx: Context, statement: Statement) {
  const rows = await ctx.db
    .select({ item: statementItems, line: chargeLines, use: vehicleUses })
    .from(statementItems)
    .innerJoin(chargeLines, eq(chargeLines.id, statementItems.charge_line_id))
    .innerJoin(vehicleUses, eq(vehicleUses.id, chargeLines.vehicle_use_id))
    .where(eq(statementItems.statement_id, statement.id))
    .orderBy(asc(vehicleUses.use_date), asc(vehicleUses.use_no), asc(chargeLines.id));
  const result: StatementItem[] = [];
  for (const { item, line, use } of rows) {
    const reasons = await eligibilityReasons(ctx, line, use, statement);
    result.push({
      eligible: !reasons.length,
      reasons,
      ...item,
      line_version: line.version,
      snapshot: await makeItemSnapshot(ctx, line, use, statement.period_start),
      supply_amount: line.approved_amount,
      tax_amount: line.tax_amount,
    });
  }
  return result;
}
function confirmationToken(statement: Statement, items: StatementItem[]) {
  const included = items
    .filter((item) => item.inclusion === 'INCLUDED')
    .map((item) => ({
      id: item.id,
      charge_line_id: item.charge_line_id,
      version: item.line_version,
      approved_amount: item.supply_amount,
      tax_amount: item.tax_amount,
      eligible: item.eligible,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return createHash('sha256')
    .update(JSON.stringify({ id: statement.id, version: statement.version, included, ...itemTotals(items) }))
    .digest('hex');
}
export async function getStatement(ctx: Context, id: string) {
  let statement = await rawStatement(ctx, id);
  const items: StatementItem[] =
    statement.status === 'DRAFT'
      ? await liveItems(ctx, statement)
      : await ctx.db
          .select()
          .from(statementItems)
          .where(eq(statementItems.statement_id, id))
          .orderBy(
            asc(sql`${statementItems.snapshot}->>'use_date'`),
            asc(sql`${statementItems.snapshot}->>'use_no'`),
            asc(statementItems.charge_line_id),
          );
  if (statement.status === 'DRAFT')
    statement = { ...statement, ...(await headerSnapshots(ctx, statement)), ...itemTotals(items) };
  const payments = await ctx.db
    .select()
    .from(paymentRecords)
    .where(eq(paymentRecords.statement_id, id))
    .orderBy(desc(paymentRecords.recorded_at));
  const replacements = await ctx.db
    .select({ id: statements.id, statement_no: statements.statement_no, status: statements.status })
    .from(statements)
    .where(eq(statements.replaces_statement_id, id));
  const paid = payments.some((p) => !p.voided_at);
  return {
    ...statement,
    confirmation_token: statement.status === 'DRAFT' ? confirmationToken(statement, items) : null,
    items,
    blocked_count: items.filter((item) => item.inclusion === 'INCLUDED' && item.eligible === false).length,
    unpriced_count: items.filter(
      (item) => item.inclusion === 'INCLUDED' && (item.supply_amount === null || item.tax_amount === null),
    ).length,
    payments,
    replacements,
    payment_status: statement.status === 'CANCELED' ? null : paid ? ('PAID' as const) : ('UNPAID' as const),
    collection_status:
      statement.status === 'CANCELED'
        ? null
        : paid
          ? 'RECEIVED'
          : statement.status === 'CONFIRMED'
            ? 'BILLED'
            : 'UNBILLED',
  };
}
async function replaceItems(
  ctx: Context,
  statement: Statement,
  input: z.output<typeof createStatementSchema>['items'],
) {
  const ids = input.map((i) => i.charge_line_id);
  const rows = await ctx.db
    .select({ line: chargeLines, use: vehicleUses })
    .from(chargeLines)
    .innerJoin(vehicleUses, eq(vehicleUses.id, chargeLines.vehicle_use_id))
    .where(inArray(chargeLines.id, ids));
  if (rows.length !== ids.length) notFound();
  for (const { line, use } of rows) {
    await assertCanReadUse(ctx, use);
    if (line.direction !== statement.direction || line.counterparty_id !== statement.counterparty_id)
      invalid('명세와 방향·거래처가 같은 비용만 선택하세요.');
    if (use.use_date > statement.period_end) invalid('정산 종료일 이후 사용 건은 포함할 수 없습니다.');
  }
  await ctx.db.delete(statementItems).where(eq(statementItems.statement_id, statement.id));
  for (const item of input) {
    const { line, use } = rows.find((r) => r.line.id === item.charge_line_id)!;
    await ctx.db.insert(statementItems).values({
      statement_id: statement.id,
      ...item,
      hold_reason: item.inclusion === 'HELD' ? item.hold_reason : null,
      snapshot: await makeItemSnapshot(ctx, line, use, statement.period_start),
      supply_amount: line.approved_amount,
      tax_amount: line.tax_amount,
    });
  }
}
function statementRequestHash(data: {
  client_request_id: string | null;
  direction: string;
  counterparty_id: string;
  period_start: string;
  period_end: string;
  title?: string | null;
  due_date?: string | null;
  replaces_statement_id?: string | null;
  items: { charge_line_id: string; inclusion?: string; hold_reason?: string | null }[];
}) {
  const normalized = {
    client_request_id: data.client_request_id,
    direction: data.direction,
    counterparty_id: data.counterparty_id,
    period_start: data.period_start,
    period_end: data.period_end,
    title: data.title ?? null,
    due_date: data.due_date ?? null,
    replaces_statement_id: data.replaces_statement_id ?? null,
    items: data.items
      .map((item) => ({
        charge_line_id: item.charge_line_id,
        inclusion: item.inclusion ?? 'INCLUDED',
        hold_reason: item.inclusion === 'HELD' ? (item.hold_reason ?? null) : null,
      }))
      .sort((a, b) => a.charge_line_id.localeCompare(b.charge_line_id)),
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
export async function createStatement(ctx: Context, input: z.input<typeof createStatementSchema>) {
  const data = createStatementSchema.parse(input);
  return atomic(ctx, async (tx) => {
    await settlementAccess(tx);
    await tx.db.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`statement:${data.client_request_id}`}, 0))`,
    );
    const [prior] = await tx.db
      .select()
      .from(statements)
      .where(eq(statements.client_request_id, data.client_request_id));
    if (prior) {
      await rawStatement(tx, prior.id);
      const [creation] = await tx.db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entity_id, prior.id),
            eq(auditLogs.entity_type, 'statement'),
            eq(auditLogs.action, 'STATEMENT_CREATE'),
          ),
        )
        .limit(1);
      const original = creation?.after as (Statement & { items: Item[]; request_hash?: string }) | undefined;
      // Older drafts retain their original creation snapshot even after edits.
      const storedHash = original?.request_hash ?? (original?.items ? statementRequestHash(original) : null);
      if (storedHash !== statementRequestHash(data))
        throw new AppError(
          'IDEMPOTENCY_MISMATCH',
          '같은 요청 식별자의 명세 내용이 다릅니다. 새 요청으로 작성하세요.',
        );
      return getStatement(tx, prior.id);
    }
    const [party] = await tx.db
      .select()
      .from(counterparties)
      .where(eq(counterparties.id, data.counterparty_id));
    if (!party || (data.direction === 'RECEIVABLE') !== (party.kind === 'CUSTOMER'))
      invalid('명세 방향에 맞는 거래처를 선택하세요.');
    if (data.replaces_statement_id) {
      const old = await rawStatement(tx, data.replaces_statement_id);
      if (
        old.status !== 'CANCELED' ||
        old.direction !== data.direction ||
        old.counterparty_id !== data.counterparty_id
      )
        invalid('같은 거래처의 취소 명세만 재작성할 수 있습니다.');
    }
    const { items, ...header } = data;
    const [statement] = await tx.db
      .insert(statements)
      .values({ ...header, ...(await headerSnapshots(tx, header)), created_by: tx.user.id })
      .returning();
    await replaceItems(tx, statement, items);
    const result = await getStatement(tx, statement.id);
    await tx.db.update(statements).set(itemTotals(result.items)).where(eq(statements.id, statement.id));
    await audit(tx, 'STATEMENT_CREATE', 'statement', statement.id, null, {
      ...result,
      request_hash: statementRequestHash(data),
    });
    return result;
  });
}
export async function updateStatement(
  ctx: Context,
  id: string,
  input: z.input<typeof updateStatementSchema>,
) {
  const data = updateStatementSchema.parse(input);
  return atomic(ctx, async (tx) => {
    const before = await rawStatement(tx, id, true);
    statementVersion(before, data.version);
    if (before.status !== 'DRAFT') invalid('초안만 변경할 수 있습니다.');
    const previous = await getStatement(tx, id);
    if (data.items) await replaceItems(tx, before, data.items);
    const totals = itemTotals(await liveItems(tx, before));
    await tx.db
      .update(statements)
      .set({
        ...totals,
        ...(data.due_date !== undefined ? { due_date: data.due_date } : {}),
        version: before.version + 1,
        updated_at: new Date(),
      })
      .where(eq(statements.id, id));
    const after = await getStatement(tx, id);
    await audit(tx, 'STATEMENT_UPDATE', 'statement', id, previous, after);
    return after;
  });
}
function blocked(details: { chargeLineId: string; useNo: string; reason: string }[]): never {
  throw new AppError('CONFIRM_BLOCKED', '확정할 수 없는 항목을 확인하세요.', details);
}
export async function confirmStatement(
  ctx: Context,
  id: string,
  input: z.input<typeof confirmStatementSchema>,
) {
  const data = confirmStatementSchema.parse(input);
  return atomic(ctx, async (tx) => {
    const before = await rawStatement(tx, id, true);
    statementVersion(before, data.version);
    if (before.status !== 'DRAFT') invalid('작성 중인 명세만 확정할 수 있습니다.');
    const items = await tx.db.select().from(statementItems).where(eq(statementItems.statement_id, id));
    const included = items.filter((i) => i.inclusion === 'INCLUDED');
    if (!included.length) blocked([{ chargeLineId: '', useNo: '', reason: '포함 항목이 없습니다.' }]);
    const allIds = items.map((i) => i.charge_line_id);
    const references = await tx.db
      .select({ id: chargeLines.vehicle_use_id })
      .from(chargeLines)
      .where(inArray(chargeLines.id, allIds));
    // Same order as W1 mutations: all parent uses, then charge IDs. No approval/evidence race.
    const uses = await tx.db
      .select()
      .from(vehicleUses)
      .where(
        inArray(
          vehicleUses.id,
          references.map((r) => r.id),
        ),
      )
      .orderBy(asc(vehicleUses.id))
      .for('update');
    const lines = await tx.db
      .select()
      .from(chargeLines)
      .where(inArray(chargeLines.id, allIds))
      .orderBy(asc(chargeLines.id))
      .for('update');
    const failures: { chargeLineId: string; useNo: string; reason: string }[] = [];
    for (const item of included) {
      const line = lines.find((l) => l.id === item.charge_line_id)!;
      const use = uses.find((u) => u.id === line.vehicle_use_id)!;
      await assertCanReadUse(tx, use);
      for (const reason of await eligibilityReasons(tx, line, use, before))
        failures.push({ chargeLineId: line.id, useNo: use.use_no, reason });
    }
    if (failures.length) blocked(failures);
    // Parent uses and lines are locked: validate exactly the content the user reviewed.
    const current = await getStatement(tx, id);
    if (data.confirmation_token !== current.confirmation_token)
      throw new AppError(
        'STATEMENT_CHANGED',
        '명세 내용이 변경되었습니다. 최신 내역과 합계를 다시 확인하세요.',
        {
          supply_total: current.supply_total,
          tax_total: current.tax_total,
          grand_total: current.grand_total,
          included_count: current.items.filter((item) => item.inclusion === 'INCLUDED').length,
          confirmation_token: current.confirmation_token,
        },
      );
    const ids = included.map((i) => i.charge_line_id);
    const locked = await tx.db
      .update(chargeLines)
      .set({ locked_statement_id: id, version: sql`${chargeLines.version} + 1`, updated_at: new Date() })
      .where(and(inArray(chargeLines.id, ids), isNull(chargeLines.locked_statement_id)))
      .returning({ id: chargeLines.id });
    if (locked.length !== ids.length)
      blocked(
        ids
          .filter((lineId) => !locked.some((l) => l.id === lineId))
          .map((lineId) => ({ chargeLineId: lineId, useNo: '', reason: '다른 명세에서 먼저 잠갔습니다.' })),
      );
    for (const item of items) {
      const line = lines.find((l) => l.id === item.charge_line_id)!;
      const use = uses.find((u) => u.id === line.vehicle_use_id)!;
      const snapshot = await makeItemSnapshot(tx, line, use, before.period_start);
      // A savepoint permits converting the final unique-index defense into a domain error.
      try {
        await tx.db.transaction(async (savepoint) => {
          await savepoint
            .update(statementItems)
            .set({
              snapshot,
              supply_amount: line.approved_amount,
              tax_amount: line.tax_amount,
              is_active_lock: item.inclusion === 'INCLUDED',
              updated_at: new Date(),
            })
            .where(eq(statementItems.id, item.id));
        });
      } catch (error) {
        let root = error as { code?: string; cause?: unknown };
        while (root.cause) root = root.cause as typeof root;
        if (root.code === '23505')
          blocked([{ chargeLineId: line.id, useNo: use.use_no, reason: '다른 확정 명세에 포함됨' }]);
        throw error;
      }
    }
    const totals = itemTotals(
      await tx.db.select().from(statementItems).where(eq(statementItems.statement_id, id)),
    );
    await tx.db
      .update(statements)
      .set({
        ...totals,
        ...(await headerSnapshots(tx, before)),
        // 19일~18일 같은 마감 기간은 끝나는 달로 부른다(예: 8/19~9/18 → 9월분).
        statement_no: await nextStatementNo(tx.db, before.direction, before.period_end),
        status: 'CONFIRMED',
        confirmed_at: new Date(),
        confirmed_by: tx.user.id,
        version: before.version + 1,
        updated_at: new Date(),
      })
      .where(eq(statements.id, id));
    const after = await getStatement(tx, id);
    await audit(tx, 'STATEMENT_CONFIRM', 'statement', id, before, after);
    return after;
  });
}
export async function cancelStatement(
  ctx: Context,
  id: string,
  input: z.input<typeof cancelStatementSchema>,
) {
  const data = cancelStatementSchema.parse(input);
  return atomic(ctx, async (tx) => {
    const before = await rawStatement(tx, id, true);
    statementVersion(before, data.version);
    if (before.status === 'CANCELED') invalid('이미 취소된 명세입니다.');
    const [payment] = await tx.db
      .select()
      .from(paymentRecords)
      .where(and(eq(paymentRecords.statement_id, id), isNull(paymentRecords.voided_at)));
    if (payment) invalid('유효한 지급·입금 기록을 먼저 취소하세요.');
    const [adjustment] = await tx.db
      .select({ id: chargeLines.id })
      .from(chargeLines)
      .where(and(eq(chargeLines.adjusts_statement_id, id), isNull(chargeLines.deleted_at)))
      .limit(1);
    if (adjustment)
      invalid('이 명세를 참조하는 유효한 조정 항목이 있어 취소할 수 없습니다. 조정 내역을 먼저 확인하세요.');
    await tx.db
      .update(chargeLines)
      .set({ locked_statement_id: null, version: sql`${chargeLines.version} + 1`, updated_at: new Date() })
      .where(eq(chargeLines.locked_statement_id, id));
    await tx.db
      .update(statementItems)
      .set({ is_active_lock: false, updated_at: new Date() })
      .where(eq(statementItems.statement_id, id));
    await tx.db
      .update(statements)
      .set({
        status: 'CANCELED',
        canceled_at: new Date(),
        canceled_by: tx.user.id,
        cancel_reason: data.reason,
        version: before.version + 1,
        updated_at: new Date(),
      })
      .where(eq(statements.id, id));
    const after = await getStatement(tx, id);
    await audit(tx, 'STATEMENT_CANCEL', 'statement', id, before, after, data.reason);
    return after;
  });
}
export async function statementScope(ctx: Context): Promise<SQL | undefined> {
  await settlementAccess(ctx);
  const ids = await accessibleProjectIds(ctx);
  if (ids === null) return undefined;
  if (!ids.length) return sql`false`;
  const projectList = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
  return sql`EXISTS (SELECT 1 FROM statement_items si WHERE si.statement_id = ${statements.id})
    AND NOT EXISTS (SELECT 1 FROM statement_items si JOIN charge_lines cl ON cl.id = si.charge_line_id
    JOIN vehicle_uses vu ON vu.id = cl.vehicle_use_id WHERE si.statement_id = ${statements.id}
    AND (CASE WHEN ${statements.status} = 'DRAFT' THEN vu.project_id::text ELSE COALESCE(si.snapshot->>'project_id', vu.project_id::text) END) NOT IN (${projectList}))`;
}
export async function filteredStatements(ctx: Context, query: z.output<typeof statementListSchema>) {
  return ctx.db
    .select()
    .from(statements)
    .where(
      and(
        await statementScope(ctx),
        query.direction ? eq(statements.direction, query.direction) : undefined,
        query.counterpartyId ? eq(statements.counterparty_id, query.counterpartyId) : undefined,
        query.status ? eq(statements.status, query.status) : undefined,
        query.periodStart ? gte(statements.period_end, query.periodStart) : undefined,
        query.periodEnd ? lte(statements.period_start, query.periodEnd) : undefined,
      ),
    )
    .orderBy((query.order === 'asc' ? asc : desc)(statements[query.sort]), asc(statements.id));
}
export async function listStatements(ctx: Context, input: z.input<typeof statementListSchema>) {
  const query = statementListSchema.parse(input);
  const all = await filteredStatements(ctx, query);
  const summaries = [];
  for (const statement of all) {
    const detail = await getStatement(ctx, statement.id);
    const { items: _items, payments: _payments, replacements: _replacements, ...summary } = detail;
    void _items;
    void _payments;
    void _replacements;
    summaries.push(summary);
  }
  if (query.sort === 'grand_total')
    summaries.sort((a, b) => (a.grand_total - b.grand_total) * (query.order === 'asc' ? 1 : -1));
  const rows = summaries.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
  return {
    rows,
    page: query.page,
    pageSize: query.pageSize,
    total: summaries.length,
    totals: {
      pageSum: sumMoney(rows.filter((s) => s.status === 'CONFIRMED').map((s) => s.grand_total)),
      filteredSum: sumMoney(summaries.filter((s) => s.status === 'CONFIRMED').map((s) => s.grand_total)),
    },
  };
}
