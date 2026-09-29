import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { chargeLines } from '../../src/server/db/schema';
import { createAdjustment } from '../../src/server/services/adjustments';
import { recordPayment, voidPayment } from '../../src/server/services/payments';
import {
  cancelStatement,
  createStatement,
  getStatement,
  statementCandidates,
  updateStatement,
} from '../../src/server/services/statements';
import { createUse, updateUse } from '../../src/server/services/uses';
import { testDatabase } from '../helpers/database';
import { approved, confirmed, draft, scenario } from './W4-fixtures';
const database = testDatabase();

describe('W6 정산 회귀', () => {
  it('5: 지급기록을 취소해도 유효 조정이 원명세를 참조하면 취소와 잠금 해제를 거부한다', async () => {
    const s = await scenario(database().db);
    const use = await approved(s);
    const statement = await confirmed(s, [use.charge_lines[0].id]);
    const payment = await recordPayment(s.adminCtx, statement.id, {
      client_request_id: randomUUID(),
      kind: 'PAYMENT',
      amount: statement.grand_total,
      paid_on: '2026-09-29',
      method: '계좌이체',
    });
    const adjustment = await createAdjustment(s.adminCtx, {
      adjusts_statement_id: statement.id,
      charge_line_id: use.charge_lines[0].id,
      supply_amount: -10000,
      reason: '초과 지급 정정',
      effective_date: '2026-10-01',
    });
    await voidPayment(s.adminCtx, payment.id, { reason: '은행 확인 정정' });
    await expect(
      cancelStatement(s.adminCtx, statement.id, { version: statement.version, reason: '재작성' }),
    ).rejects.toThrow('조정');
    expect((await getStatement(s.adminCtx, statement.id)).status).toBe('CONFIRMED');
    const [line] = await database()
      .db.select()
      .from(chargeLines)
      .where(eq(chargeLines.id, use.charge_lines[0].id));
    expect(line.locked_statement_id).toBe(statement.id);
    await database()
      .db.update(chargeLines)
      .set({ deleted_at: new Date() })
      .where(eq(chargeLines.id, adjustment.id));
    expect(
      (
        await cancelStatement(s.adminCtx, statement.id, {
          version: statement.version,
          reason: '조정 폐기 후 재작성',
        })
      ).status,
    ).toBe('CANCELED');
  });

  it('7: 초안 합계는 포함 가능한 금액만 합산하고 미확정 포함 항목 수를 따로 반환한다', async () => {
    const s = await scenario(database().db);
    const priced = await approved(s);
    const unpriced = await createUse(s.adminCtx, { ...s.input, billing_unit: 'PER_TON', quantity: '2' });
    const statement = await draft(s, [priced.charge_lines[0].id, unpriced.charge_lines[0].id]);
    expect(statement).toMatchObject({ grand_total: 300000, blocked_count: 1, unpriced_count: 1 });
    await updateUse(s.adminCtx, priced.id, { version: priced.version, notes: '재검수 필요' });
    expect(await getStatement(s.adminCtx, statement.id)).toMatchObject({ grand_total: 0, blocked_count: 2 });
  });

  it('8: client_request_id의 원래 본문을 보존하고 변경된 재요청은 422로 거절한다', async () => {
    const s = await scenario(database().db);
    const use = await approved(s);
    const input = {
      client_request_id: randomUUID(),
      direction: 'PAYABLE' as const,
      counterparty_id: s.payee.id,
      period_start: '2026-09-01',
      period_end: '2026-09-30',
      items: [{ charge_line_id: use.charge_lines[0].id }],
    };
    const first = await createStatement(s.adminCtx, input);
    await expect(createStatement(s.adminCtx, { ...input, title: '다른 정산 요청' })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_MISMATCH',
      status: 422,
    });
    await updateStatement(s.adminCtx, first.id, { version: first.version, due_date: '2026-10-10' });
    expect((await createStatement(s.adminCtx, input)).id).toBe(first.id);
  });

  it('10: 초안 후보는 자신을 다른 초안으로 보지 않고 추가/제거한 항목만 저장한다', async () => {
    const s = await scenario(database().db);
    const first = await approved(s);
    const second = await approved(s);
    const statement = await draft(s, [first.charge_lines[0].id]);
    const candidates = await statementCandidates(s.adminCtx, {
      statementId: statement.id,
      direction: 'PAYABLE',
      counterpartyId: s.payee.id,
      periodStart: statement.period_start,
      periodEnd: statement.period_end,
    });
    expect(candidates.rows.every((row) => row.eligible)).toBe(true);
    const updated = await updateStatement(s.adminCtx, statement.id, {
      version: statement.version,
      items: [{ charge_line_id: second.charge_lines[0].id }],
    });
    expect(updated.items.map((item) => item.charge_line_id)).toEqual([second.charge_lines[0].id]);
    expect(updated.grand_total).toBe(300000);
  });
});
