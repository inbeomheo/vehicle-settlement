import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { describe, expect, it } from 'vitest';
import * as schema from '../../src/server/db/schema';
import {
  chargeLines,
  projects,
  statementItems,
  statements,
  vehicleUses,
  useRevisions,
  auditLogs,
} from '../../src/server/db/schema';
import { createUse, submitUse, approveUse, updateUse } from '../../src/server/services/uses';
import {
  cancelStatement,
  confirmStatement,
  createStatement,
  getStatement,
  listStatements,
  statementCandidates,
  updateStatement,
} from '../../src/server/services/statements';
import { testDatabase } from '../helpers/database';
import { approved, confirmed, draft, scenario } from './W4-fixtures';
const database = testDatabase();
describe('W4 월 정산과 확정 잠금', () => {
  it('U001 200,000+30,000, U002 일대 300,000/5운행 = 530,000; 늦게 승인된 9/30 사용분 400,000은 10월 전월분', async () => {
    const s = await scenario(database().db);
    await s.f.rate(s.payee.id, {
      billing_unit: 'PER_TRIP',
      unit_price: 200000,
      tax_mode: 'TAX_EXEMPT',
      project_id: s.project.id,
    });
    const fiveTon = await s.f.vehicle({ tonnage: '5' });
    const u1 = await approved(
      s,
      {
        use_date: '2026-09-10',
        vehicle_id: fiveTon.id,
        charge_lines: [
          { charge_type: 'BASE', billing_unit: 'PER_TRIP', quantity: '1' },
          { charge_type: 'WAITING', requested_amount: 30000, reason: '현장 대기' },
        ],
      },
      'TAX_EXEMPT',
    );
    const u2 = await approved(s, {
      trips: Array.from({ length: 5 }, (_, i) => ({ seq: i + 1, origin: '상차장', destination: '현장' })),
    });
    await s.f.rate(s.payee.id, {
      billing_unit: 'LUMP_SUM',
      unit_price: 400000,
      tax_mode: 'TAX_EXEMPT',
      project_id: s.project.id,
    });
    const u3 = await createUse(s.adminCtx, { ...s.input, use_date: '2026-09-30', billing_unit: 'LUMP_SUM' });
    const submitted = await submitUse(s.adminCtx, u3.id, { version: u3.version });
    const candidates = await statementCandidates(s.adminCtx, {
      direction: 'PAYABLE',
      counterpartyId: s.payee.id,
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
    });
    expect(candidates.rows.find((r) => r.snapshot.use_no === u3.use_no)?.reasons).toContain('사용 건 미승인');
    const september = await confirmed(
      s,
      [...u1.charge_lines, ...u2.charge_lines].map((l) => l.id),
    );
    expect(september.grand_total).toBe(530000);
    expect(september.items.find((i) => i.snapshot?.use_no === u2.use_no)?.snapshot).toMatchObject({
      trip_count: 5,
      quantity: '1.000',
      supply_amount: 300000,
    });
    const approvedLate = await approveUse(s.adminCtx, u3.id, { version: submitted.version });
    await database()
      .db.update(useRevisions)
      .set({ decided_at: new Date('2026-10-02T09:00:00+09:00') })
      .where(eq(useRevisions.id, approvedLate.approved_revision_id!));
    const octoberCandidates = await statementCandidates(s.adminCtx, {
      direction: 'PAYABLE',
      counterpartyId: s.payee.id,
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
    });
    expect(octoberCandidates.rows).toHaveLength(1);
    expect(octoberCandidates.rows[0]).toMatchObject({
      eligible: true,
      snapshot: { use_date: '2026-09-30', carried_forward: true, supply_amount: 400000 },
    });
    const octoberDraft = await draft(
      s,
      approvedLate.charge_lines.map((l) => l.id),
      { period_start: '2026-10-01', period_end: '2026-10-31' },
    );
    const october = await confirmStatement(s.adminCtx, octoberDraft.id, {
      confirmation_token: octoberDraft.confirmation_token!,
      version: octoberDraft.version,
    });
    expect(october.grand_total).toBe(400000);
    expect((await getStatement(s.adminCtx, september.id)).grand_total).toBe(530000);
  });
  it('별도 커넥션·두 담당자의 동시 확정은 하나만 성공하고 전체 패자는 CONFIRM_BLOCKED', async () => {
    const s = await scenario(database().db);
    const use = await approved(s);
    const first = await draft(
      s,
      use.charge_lines.map((l) => l.id),
    );
    const second = await draft(
      s,
      use.charge_lines.map((l) => l.id),
    );
    const another = await s.f.user({ role: 'SETTLEMENT_MANAGER', all_projects: true });
    const a = await database().pool.connect();
    const b = await database().pool.connect();
    try {
      expect((await a.query('select pg_backend_pid() pid')).rows[0].pid).not.toBe(
        (await b.query('select pg_backend_pid() pid')).rows[0].pid,
      );
      const results = await Promise.allSettled([
        confirmStatement({ ...s.adminCtx, db: drizzle(a, { schema }) }, first.id, {
          confirmation_token: first.confirmation_token!,
          version: 1,
        }),
        confirmStatement({ ...s.adminCtx, user: another, db: drizzle(b, { schema }) }, second.id, {
          confirmation_token: second.confirmation_token!,
          version: 1,
        }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failure = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(failure.reason).toMatchObject({
        code: 'CONFIRM_BLOCKED',
        details: [
          expect.objectContaining({
            chargeLineId: use.charge_lines[0].id,
            reason: '다른 확정 명세에 포함됨',
          }),
        ],
      });
      const active = await database()
        .db.select()
        .from(statementItems)
        .where(
          and(
            eq(statementItems.charge_line_id, use.charge_lines[0].id),
            eq(statementItems.is_active_lock, true),
          ),
        );
      expect(active).toHaveLength(1);
    } finally {
      a.release();
      b.release();
    }
  });
  it('PAYABLE과 RECEIVABLE은 같은 사용 건에서도 독립 확정한다', async () => {
    const s = await scenario(database().db);
    const customer = await s.f.counterparty({ kind: 'CUSTOMER' });
    await s.f.rate(customer.id, { direction: 'RECEIVABLE', unit_price: 350000, tax_mode: 'TAX_EXEMPT' });
    const use = await approved(s, { customer_counterparty_id: customer.id });
    const pay = await confirmed(
      s,
      use.charge_lines.filter((l) => l.direction === 'PAYABLE').map((l) => l.id),
    );
    const billDraft = await draft(
      s,
      use.charge_lines.filter((l) => l.direction === 'RECEIVABLE').map((l) => l.id),
      { direction: 'RECEIVABLE', counterparty_id: customer.id },
    );
    const bill = await confirmStatement(s.adminCtx, billDraft.id, {
      confirmation_token: billDraft.confirmation_token!,
      version: 1,
    });
    expect(pay.grand_total).toBe(300000);
    expect(bill.grand_total).toBe(350000);
    expect(pay.statement_no).toMatch(/^PAY-202609-/);
    expect(bill.statement_no).toMatch(/^BIL-202609-/);
  });
  it.each([
    ['단가 미확정', { price_status: 'PENDING' as const }],
    ['승인액 없음', { approved_amount: null }],
    ['세액 미확정', { tax_amount: null }],
    ['라인 보류', { line_review_status: 'HELD' as const }],
    ['삭제된 비용', { deleted_at: new Date() }],
  ])('%s는 확정 시 재검사하여 항목별 차단 사유를 반환한다', async (reason, change) => {
    const s = await scenario(database().db);
    const use = await approved(s);
    const statement = await draft(
      s,
      use.charge_lines.map((l) => l.id),
    );
    await database().db.update(chargeLines).set(change).where(eq(chargeLines.id, use.charge_lines[0].id));
    await expect(
      confirmStatement(s.adminCtx, statement.id, {
        confirmation_token: statement.confirmation_token!,
        version: 1,
      }),
    ).rejects.toMatchObject({
      code: 'CONFIRM_BLOCKED',
      details: expect.arrayContaining([expect.objectContaining({ reason })]),
    });
    expect((await getStatement(s.adminCtx, statement.id)).status).toBe('DRAFT');
    const [line] = await database()
      .db.select()
      .from(chargeLines)
      .where(eq(chargeLines.id, use.charge_lines[0].id));
    expect(line.locked_statement_id).toBeNull();
  });
  it('사용 승인과 필수증빙 재검사, 0원 CONFIRMED 허용, 보류는 잠그지 않음', async () => {
    const s = await scenario(database().db);
    const use = await approved(s, {
      charge_lines: [
        { charge_type: 'BASE', billing_unit: 'PER_DAY' },
        { charge_type: 'WAITING', requested_amount: 100, reason: '대기' },
      ],
    });
    const base = use.charge_lines.find((l) => l.charge_type === 'BASE')!;
    const held = use.charge_lines.find((l) => l.charge_type === 'WAITING')!;
    await database()
      .db.update(chargeLines)
      .set({ approved_amount: 0, tax_amount: 0 })
      .where(eq(chargeLines.id, base.id));
    const statement = await draft(s, [], {
      items: [
        { charge_line_id: base.id },
        { charge_line_id: held.id, inclusion: 'HELD', hold_reason: '추가 확인' },
      ],
    });
    await database()
      .db.update(projects)
      .set({ evidence_policy: 'PHOTO_REQUIRED' })
      .where(eq(projects.id, s.project.id));
    await expect(
      confirmStatement(s.adminCtx, statement.id, {
        confirmation_token: statement.confirmation_token!,
        version: 1,
      }),
    ).rejects.toMatchObject({
      code: 'CONFIRM_BLOCKED',
      details: expect.arrayContaining([expect.objectContaining({ reason: '필수증빙 미충족' })]),
    });
    await database()
      .db.update(projects)
      .set({ evidence_policy: 'NONE' })
      .where(eq(projects.id, s.project.id));
    await database()
      .db.update(vehicleUses)
      .set({ review_status: 'SUBMITTED' })
      .where(eq(vehicleUses.id, use.id));
    await expect(
      confirmStatement(s.adminCtx, statement.id, {
        confirmation_token: statement.confirmation_token!,
        version: 1,
      }),
    ).rejects.toMatchObject({
      code: 'CONFIRM_BLOCKED',
      details: expect.arrayContaining([expect.objectContaining({ reason: '사용 건 미승인' })]),
    });
    await database()
      .db.update(vehicleUses)
      .set({ review_status: 'APPROVED' })
      .where(eq(vehicleUses.id, use.id));
    const result = await confirmStatement(s.adminCtx, statement.id, {
      confirmation_token: statement.confirmation_token!,
      version: 1,
    });
    expect(result.grand_total).toBe(0);
    expect(result.items.find((i) => i.charge_line_id === held.id)).toMatchObject({
      inclusion: 'HELD',
      is_active_lock: false,
      hold_reason: '추가 확인',
    });
    const candidates = await statementCandidates(s.adminCtx, {
      direction: 'PAYABLE',
      counterpartyId: s.payee.id,
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
    });
    expect(candidates.rows.map((r) => r.charge_line_id)).toEqual([held.id]);
  });
  it('취소 사유·잠금 해제·이력·재작성 연결 및 버전 충돌', async () => {
    const s = await scenario(database().db);
    const use = await approved(s);
    const statement = await confirmed(
      s,
      use.charge_lines.map((l) => l.id),
    );
    await expect(
      updateUse(s.adminCtx, use.id, { version: use.version, notes: '변경' }),
    ).rejects.toMatchObject({ code: 'STATEMENT_LOCKED' });
    await expect(
      cancelStatement(s.adminCtx, statement.id, { version: 1, reason: '오류' }),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    await expect(
      cancelStatement(s.adminCtx, statement.id, { version: statement.version, reason: ' ' }),
    ).rejects.toThrow();
    const canceled = await cancelStatement(s.adminCtx, statement.id, {
      version: statement.version,
      reason: '거래처 확인 후 재작성',
    });
    expect(canceled.status).toBe('CANCELED');
    expect(canceled.items.every((i) => !i.is_active_lock)).toBe(true);
    const next = await draft(
      s,
      use.charge_lines.map((l) => l.id),
      { replaces_statement_id: statement.id },
    );
    await confirmStatement(s.adminCtx, next.id, { confirmation_token: next.confirmation_token!, version: 1 });
    const old = await getStatement(s.adminCtx, statement.id);
    expect(old).toMatchObject({
      status: 'CANCELED',
      grand_total: 300000,
      cancel_reason: '거래처 확인 후 재작성',
    });
    expect(old.replacements[0].id).toBe(next.id);
  });
  it('생성 멱등, 후보 다른 초안 사유, 보류 사유와 날짜 검증, 페이지 합계', async () => {
    const s = await scenario(database().db);
    const use = await approved(s);
    const key = randomUUID();
    const first = await draft(
      s,
      use.charge_lines.map((l) => l.id),
      { client_request_id: key },
    );
    expect(
      (
        await draft(
          s,
          use.charge_lines.map((l) => l.id),
          { client_request_id: key },
        )
      ).id,
    ).toBe(first.id);
    const rows = await statementCandidates(s.adminCtx, {
      direction: 'PAYABLE',
      counterpartyId: s.payee.id,
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
    });
    expect(rows.rows[0].reasons).toContain('다른 초안에 포함 중');
    await expect(
      updateStatement(s.adminCtx, first.id, {
        version: 1,
        items: [{ charge_line_id: use.charge_lines[0].id, inclusion: 'HELD' }],
      }),
    ).rejects.toThrow();
    const changed = await updateStatement(s.adminCtx, first.id, { version: 1, due_date: '2026-10-10' });
    expect(changed.version).toBe(2);
    await expect(updateStatement(s.adminCtx, first.id, { version: 1, due_date: null })).rejects.toMatchObject(
      { code: 'VERSION_CONFLICT' },
    );
    await expect(
      createStatement(s.adminCtx, {
        client_request_id: randomUUID(),
        direction: 'PAYABLE',
        counterparty_id: s.payee.id,
        period_start: '2026-10-31',
        period_end: '2026-10-01',
        items: [{ charge_line_id: use.charge_lines[0].id }],
      }),
    ).rejects.toThrow();
    await draft(
      s,
      use.charge_lines.map((l) => l.id),
    );
    const listed = await listStatements(s.adminCtx, { counterpartyId: s.payee.id, pageSize: 1 });
    expect(listed).toMatchObject({ total: 2, totals: { pageSum: 300000, filteredSum: 600000 } });
    const logs = await database().db.select().from(auditLogs).where(eq(auditLogs.entity_id, first.id));
    expect(logs.map((l) => l.action)).toEqual(['STATEMENT_CREATE', 'STATEMENT_UPDATE']);
    const unlocked = await database()
      .db.select()
      .from(chargeLines)
      .where(and(eq(chargeLines.id, use.charge_lines[0].id), isNull(chargeLines.locked_statement_id)));
    expect(unlocked).toHaveLength(1);
    expect(
      await database().db.select().from(statements).where(eq(statements.client_request_id, key)),
    ).toHaveLength(1);
  });
});
