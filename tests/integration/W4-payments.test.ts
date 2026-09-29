import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditLogs, chargeLines, paymentRecords } from '../../src/server/db/schema';
import { createAdjustment } from '../../src/server/services/adjustments';
import { paymentOverview, recordPayment, voidPayment } from '../../src/server/services/payments';
import {
  cancelStatement,
  confirmStatement,
  getStatement,
  statementCandidates,
} from '../../src/server/services/statements';
import { POST as paymentRoute } from '../../src/app/api/statements/[id]/payments/route';
import { POST as confirmRoute } from '../../src/app/api/statements/[id]/confirm/route';
import { POST as adjustmentRoute } from '../../src/app/api/adjustments/route';
import { testDatabase } from '../helpers/database';
import { callRoute } from '../helpers/routes';
import { approved, confirmed, draft, scenario } from './W4-fixtures';
const database = testDatabase();
const payment = (amount: number) => ({
  client_request_id: randomUUID(),
  kind: 'PAYMENT' as const,
  amount,
  paid_on: '2026-09-29',
  method: '계좌이체',
  reference: '송금-1',
  memo: '전액 지급',
});
describe('W4 지급·입금·조정', () => {
  it('확정·전액·방향만 허용하며 지급 PAID → void UNPAID, 취소 이력과 원기록 보존', async () => {
    const s = await scenario(database().db);
    const use = await approved(s);
    const initial = await draft(
      s,
      use.charge_lines.map((l) => l.id),
    );
    await expect(recordPayment(s.adminCtx, initial.id, payment(300000))).rejects.toThrow('확정 명세');
    const statement = await confirmStatement(s.adminCtx, initial.id, {
      confirmation_token: initial.confirmation_token!,
      version: 1,
    });
    await expect(recordPayment(s.adminCtx, statement.id, payment(100000))).rejects.toThrow('전액');
    await expect(
      recordPayment(s.adminCtx, statement.id, { ...payment(300000), kind: 'RECEIPT' }),
    ).rejects.toThrow('종류');
    const record = await recordPayment(s.adminCtx, statement.id, payment(300000));
    expect((await getStatement(s.adminCtx, statement.id)).payment_status).toBe('PAID');
    await expect(
      cancelStatement(s.adminCtx, statement.id, { version: statement.version, reason: '수정' }),
    ).rejects.toThrow('기록을 먼저 취소');
    await expect(voidPayment(s.adminCtx, record.id, { reason: '' })).rejects.toThrow();
    const voided = await voidPayment(s.adminCtx, record.id, { reason: '은행 입금 확인 오류' });
    expect(voided.voided_at).toBeTruthy();
    expect(voided.amount).toBe(300000);
    expect((await getStatement(s.adminCtx, statement.id)).payment_status).toBe('UNPAID');
    await recordPayment(s.adminCtx, statement.id, payment(300000));
    const detail = await getStatement(s.adminCtx, statement.id);
    expect(detail.payments).toHaveLength(2);
    expect(detail.payments.filter((p) => p.voided_at)).toHaveLength(1);
    const logs = await database().db.select().from(auditLogs).where(eq(auditLogs.entity_id, record.id));
    expect(logs.map((l) => l.action)).toEqual(['PAYMENT_RECORD', 'PAYMENT_VOID']);
  });
  it('동일 Idempotency-Key 확정·지급의 동시 API 재전송은 성공 응답을 재생하고 한 번만 반영', async () => {
    const s = await scenario(database().db);
    const use = await approved(s);
    const statement = await draft(
      s,
      use.charge_lines.map((l) => l.id),
    );
    const { token } = await s.f.session(s.admin.id);
    const confirmOptions = {
      method: 'POST',
      path: `/api/statements/${statement.id}/confirm`,
      params: { id: statement.id },
      token,
      body: { version: 1, confirmation_token: statement.confirmation_token! },
      headers: { 'idempotency-key': randomUUID() },
    };
    const confirmations = await Promise.all([
      callRoute(database().db, confirmRoute, confirmOptions),
      callRoute(database().db, confirmRoute, confirmOptions),
    ]);
    expect(confirmations.map((r) => r.status)).toEqual([200, 200]);
    const body = payment(300000);
    const options = {
      method: 'POST',
      path: `/api/statements/${statement.id}/payments`,
      params: { id: statement.id },
      token,
      body,
      headers: { 'idempotency-key': randomUUID() },
    };
    const responses = await Promise.all([
      callRoute(database().db, paymentRoute, options),
      callRoute(database().db, paymentRoute, options),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(responses.some((r) => r.headers.get('idempotency-replayed') === 'true')).toBe(true);
    expect((await responses[0].json()).data.id).toBe((await responses[1].json()).data.id);
    expect(
      await database().db.select().from(paymentRecords).where(eq(paymentRecords.statement_id, statement.id)),
    ).toHaveLength(1);
    const mismatch = await callRoute(database().db, paymentRoute, {
      ...options,
      body: { ...body, memo: '다른 내용' },
    });
    expect(mismatch.status).toBe(422);
    expect((await mismatch.json()).error.code).toBe('IDEMPOTENCY_MISMATCH');
  });
  it('별도 멱등 키로 전액 지급을 동시에 기록해도 한 건만 유효하며 client_request_id도 멱등', async () => {
    const s = await scenario(database().db);
    const use = await approved(s);
    const statement = await confirmed(
      s,
      use.charge_lines.map((l) => l.id),
    );
    const data = payment(300000);
    const results = await Promise.allSettled([
      recordPayment(s.adminCtx, statement.id, data),
      recordPayment(s.adminCtx, statement.id, payment(300000)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const records = await database()
      .db.select()
      .from(paymentRecords)
      .where(eq(paymentRecords.statement_id, statement.id));
    expect(records).toHaveLength(1);
    const stored = records[0];
    expect(
      (
        await recordPayment(s.adminCtx, statement.id, {
          ...data,
          client_request_id: stored.client_request_id!,
        })
      ).id,
    ).toBe(stored.id);
  });
  it('미지급·예정일 경과·운송사/현장별 집계와 입금 용어 상태를 독립 처리한다', async () => {
    const s = await scenario(database().db);
    const use = await approved(s);
    const initial = await draft(
      s,
      use.charge_lines.map((l) => l.id),
      { due_date: '2020-01-01' },
    );
    const statement = await confirmStatement(s.adminCtx, initial.id, {
      confirmation_token: initial.confirmation_token!,
      version: 1,
    });
    const overview = await paymentOverview(s.adminCtx, {
      direction: 'PAYABLE',
      counterpartyId: s.payee.id,
      state: 'OVERDUE',
    });
    expect(overview).toMatchObject({
      total: 1,
      totals: { filteredSum: 300000 },
      groups: [
        expect.objectContaining({
          project_id: s.project.id,
          unpaid_count: 1,
          unpaid_amount: 300000,
          overdue_count: 1,
        }),
      ],
    });
    await recordPayment(s.adminCtx, statement.id, payment(300000));
    expect((await paymentOverview(s.adminCtx, { counterpartyId: s.payee.id, state: 'UNPAID' })).total).toBe(
      0,
    );
    const customer = await s.f.counterparty({ kind: 'CUSTOMER' });
    await s.f.rate(customer.id, { direction: 'RECEIVABLE', unit_price: 400000, tax_mode: 'TAX_EXEMPT' });
    const u2 = await approved(s, { customer_counterparty_id: customer.id });
    const bill = await draft(
      s,
      u2.charge_lines.filter((l) => l.direction === 'RECEIVABLE').map((l) => l.id),
      { direction: 'RECEIVABLE', counterparty_id: customer.id },
    );
    const billed = await confirmStatement(s.adminCtx, bill.id, {
      confirmation_token: bill.confirmation_token!,
      version: 1,
    });
    expect(billed.collection_status).toBe('BILLED');
    await recordPayment(s.adminCtx, bill.id, { ...payment(400000), kind: 'RECEIPT' });
    expect((await getStatement(s.adminCtx, bill.id)).collection_status).toBe('RECEIVED');
  });
  it('지급 후 음수 조정은 원명세를 유지하고 다음 기간 후보에만 나타나며 세액을 서버 계산', async () => {
    const s = await scenario(database().db);
    const use = await approved(s);
    const statement = await confirmed(
      s,
      use.charge_lines.map((l) => l.id),
    );
    const input = {
      adjusts_statement_id: statement.id,
      charge_line_id: use.charge_lines[0].id,
      supply_amount: -30000,
      reason: '초과 지급분 환급',
      effective_date: '2026-10-01',
    };
    await expect(createAdjustment(s.adminCtx, input)).rejects.toThrow('지급·입금 완료');
    await recordPayment(s.adminCtx, statement.id, payment(300000));
    await expect(createAdjustment(s.adminCtx, { ...input, reason: ' ' })).rejects.toThrow();
    await expect(createAdjustment(s.adminCtx, { ...input, effective_date: '2026-09-30' })).rejects.toThrow(
      '이후',
    );
    const { token } = await s.f.session(s.admin.id);
    const options = {
      method: 'POST',
      path: '/api/adjustments',
      token,
      body: input,
      headers: { 'idempotency-key': randomUUID() },
    };
    const first = await callRoute(database().db, adjustmentRoute, options);
    expect(first.status).toBe(200);
    const adjustment = (await first.json()).data;
    expect(adjustment).toMatchObject({
      charge_type: 'ADJUSTMENT',
      approved_amount: -30000,
      tax_amount: 0,
      adjusts_statement_id: statement.id,
    });
    expect(
      (await callRoute(database().db, adjustmentRoute, options)).headers.get('idempotency-replayed'),
    ).toBe('true');
    expect(
      await database()
        .db.select()
        .from(chargeLines)
        .where(eq(chargeLines.adjusts_statement_id, statement.id)),
    ).toHaveLength(1);
    const september = await statementCandidates(s.adminCtx, {
      direction: 'PAYABLE',
      counterpartyId: s.payee.id,
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
    });
    expect(september.rows).toHaveLength(0);
    const october = await statementCandidates(s.adminCtx, {
      direction: 'PAYABLE',
      counterpartyId: s.payee.id,
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
    });
    expect(october.rows[0]).toMatchObject({
      eligible: true,
      charge_line_id: adjustment.id,
      snapshot: { carried_forward: true },
    });
    const adjustmentDraft = await draft(s, [adjustment.id], {
      period_start: '2026-10-01',
      period_end: '2026-10-31',
    });
    expect(
      (
        await confirmStatement(s.adminCtx, adjustmentDraft.id, {
          confirmation_token: adjustmentDraft.confirmation_token!,
          version: 1,
        })
      ).grand_total,
    ).toBe(-30000);
    expect(await getStatement(s.adminCtx, statement.id)).toMatchObject({
      grand_total: 300000,
      payment_status: 'PAID',
    });
  });
});
