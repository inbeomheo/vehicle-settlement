import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Context } from '../context';
import { todaySeoul } from '../context';
import { audit } from '../audit';
import { paymentRecords } from '../db/schema';
import { invalid, notFound } from '../errors';
import { sumMoney } from '../domain/money';
import { atomic } from './uses';
import { uuid } from './schemas';
import { filteredStatements, getStatement, rawStatement, type ItemSnapshot } from './statements';
import { paymentOverviewSchema, paymentSchema, voidPaymentSchema } from './statements-schemas';
export async function recordPayment(ctx: Context, id: string, input: z.input<typeof paymentSchema>) {
  const data = paymentSchema.parse(input);
  return atomic(ctx, async (tx) => {
    await tx.db.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`payment:${data.client_request_id}`}, 0))`,
    );
    const statement = await rawStatement(tx, id, true);
    const [prior] = await tx.db
      .select()
      .from(paymentRecords)
      .where(eq(paymentRecords.client_request_id, data.client_request_id));
    if (prior) {
      if (
        prior.statement_id !== id ||
        prior.amount !== data.amount ||
        prior.kind !== data.kind ||
        prior.paid_on !== data.paid_on ||
        prior.method !== data.method ||
        (prior.reference ?? '') !== (data.reference ?? '') ||
        (prior.memo ?? '') !== (data.memo ?? '')
      )
        invalid('같은 요청 식별자의 지급 내용이 다릅니다.');
      return prior;
    }
    if (statement.status !== 'CONFIRMED') invalid('확정 명세에만 지급·입금을 기록할 수 있습니다.');
    if (data.kind !== (statement.direction === 'PAYABLE' ? 'PAYMENT' : 'RECEIPT'))
      invalid('명세 방향에 맞는 지급·입금 종류를 선택하세요.');
    if (data.amount !== statement.grand_total) invalid('명세 총액 전액만 기록할 수 있습니다.');
    const [active] = await tx.db
      .select()
      .from(paymentRecords)
      .where(and(eq(paymentRecords.statement_id, id), isNull(paymentRecords.voided_at)));
    if (active) invalid('이미 지급·입금 완료된 명세입니다.');
    const [record] = await tx.db
      .insert(paymentRecords)
      .values({ ...data, statement_id: id, recorded_by: tx.user.id })
      .returning();
    await audit(tx, 'PAYMENT_RECORD', 'payment', record.id, null, record);
    return record;
  });
}
export async function voidPayment(ctx: Context, id: string, input: z.input<typeof voidPaymentSchema>) {
  uuid.parse(id);
  const data = voidPaymentSchema.parse(input);
  return atomic(ctx, async (tx) => {
    const [reference] = await tx.db.select().from(paymentRecords).where(eq(paymentRecords.id, id));
    if (!reference) notFound();
    await rawStatement(tx, reference.statement_id, true);
    const [before] = await tx.db.select().from(paymentRecords).where(eq(paymentRecords.id, id)).for('update');
    if (before.voided_at) invalid('이미 취소된 지급·입금 기록입니다.');
    const [after] = await tx.db
      .update(paymentRecords)
      .set({ voided_at: new Date(), voided_by: tx.user.id, void_reason: data.reason, updated_at: new Date() })
      .where(eq(paymentRecords.id, id))
      .returning();
    await audit(tx, 'PAYMENT_VOID', 'payment', id, before, after, data.reason);
    return after;
  });
}
export async function paymentOverview(ctx: Context, input: z.input<typeof paymentOverviewSchema>) {
  const query = paymentOverviewSchema.parse(input);
  const statements = await filteredStatements(ctx, { ...query, status: 'CONFIRMED' });
  const all = [];
  for (const statement of statements) {
    const detail = await getStatement(ctx, statement.id);
    const overdue = detail.payment_status === 'UNPAID' && !!detail.due_date && detail.due_date < todaySeoul();
    if (query.state === 'OVERDUE' && !overdue) continue;
    if (query.state === 'UNPAID' && detail.payment_status !== 'UNPAID') continue;
    if (query.state === 'PAID' && detail.payment_status !== 'PAID') continue;
    all.push({ ...detail, overdue });
  }
  const grouped = new Map<
    string,
    {
      counterparty_id: string;
      counterparty_name: string;
      direction: string;
      project_id: string;
      project_name: string;
      count: number;
      amount: number;
      unpaid_count: number;
      unpaid_amount: number;
      overdue_count: number;
      overdue_amount: number;
    }
  >();
  for (const statement of all) {
    const projects = new Map<string, { name: string; amounts: number[] }>();
    for (const item of statement.items.filter((i) => i.inclusion === 'INCLUDED')) {
      const snapshot = item.snapshot as ItemSnapshot;
      const entry = projects.get(snapshot.project_id) ?? { name: snapshot.project_name, amounts: [] };
      entry.amounts.push(sumMoney([item.supply_amount, item.tax_amount]));
      projects.set(snapshot.project_id, entry);
    }
    for (const [projectId, project] of projects) {
      const key = `${statement.direction}:${statement.counterparty_id}:${projectId}`;
      const entry = grouped.get(key) ?? {
        direction: statement.direction,
        counterparty_id: statement.counterparty_id,
        counterparty_name: String(statement.counterparty_snapshot?.name ?? ''),
        project_id: projectId,
        project_name: project.name,
        count: 0,
        amount: 0,
        unpaid_count: 0,
        unpaid_amount: 0,
        overdue_count: 0,
        overdue_amount: 0,
      };
      entry.count++;
      entry.amount = sumMoney([entry.amount, sumMoney(project.amounts)]);
      if (statement.payment_status === 'UNPAID') {
        entry.unpaid_count++;
        entry.unpaid_amount = sumMoney([entry.unpaid_amount, sumMoney(project.amounts)]);
      }
      if (statement.overdue) {
        entry.overdue_count++;
        entry.overdue_amount = sumMoney([entry.overdue_amount, sumMoney(project.amounts)]);
      }
      grouped.set(key, entry);
    }
  }
  const rows = all.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
  return {
    rows,
    groups: [...grouped.values()],
    total: all.length,
    page: query.page,
    pageSize: query.pageSize,
    totals: {
      pageSum: sumMoney(rows.map((s) => s.grand_total)),
      filteredSum: sumMoney(all.map((s) => s.grand_total)),
    },
  };
}
