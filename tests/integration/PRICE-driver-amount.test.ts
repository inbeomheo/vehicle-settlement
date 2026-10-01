import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { auditLogs, rateAgreements } from '../../src/server/db/schema';
import {
  approveUse,
  createUse,
  getUse,
  listUses,
  submitUse,
  updateUse,
} from '../../src/server/services/uses';
import { getLedger } from '../../src/server/services/ledger';
import { getSummary } from '../../src/server/services/summary';
import { getDashboard } from '../../src/server/services/dashboard';
import { driverSettlements } from '../../src/server/services/statements-driver';
import { statementCandidates } from '../../src/server/services/statements';
import { getRecentRoutes } from '../../src/server/services/ledger-recent';
import { confirmed } from './W4-fixtures';
import { calculateTax } from '../../src/server/domain/money';
import { proposedAmount } from '../../src/shared/charge-amount';
import { commitImport, previewImport, uploadImport } from '../../src/server/services/import';

const database = testDatabase();
const period = { periodStart: '2026-09-01', periodEnd: '2026-09-30' };
const base = (requested_amount?: number | null) => ({ charge_type: 'BASE' as const, requested_amount });
async function fixture(contract = true) {
  const s = await setupScenario(database().db);
  if (!contract)
    await database().db.update(rateAgreements).set({ active: false }).where(eq(rateAgreements.id, s.rate.id));
  return s;
}
async function submit(s: Awaited<ReturnType<typeof fixture>>, amount?: number | null) {
  const use = await createUse(s.driverCtx, { ...s.input, charge_lines: [base(amount)] });
  return submitUse(s.driverCtx, use.id, { version: use.version });
}

describe('PRICE 기사 운행 금액 → 담당자 확인', () => {
  it.each([false, true])(
    '계약 %s: 요청액을 검수·기사·집계·후보에서 일관되게 표시하고 승인·세금·명세 잠금까지 적용한다',
    async (contract) => {
      const s = await fixture(contract);
      const use = await submit(s, 140000);
      const line = use.charge_lines[0];
      expect(line).toMatchObject({
        requested_amount: 140000,
        computed_amount: contract ? 300000 : null,
        price_status: 'CONFIRMED',
        approved_amount: null,
      });
      const row = (await getLedger(s.adminCtx, { use_id: use.id })).rows[0];
      expect(row).toMatchObject({
        review_base_amount: 140000,
        review_total_amount: 140000,
        has_base_amount_difference: contract,
        has_requested_extra: false,
      });
      expect((await listUses(s.driverCtx, {})).rows[0].payable_base_amount).toBe(140000);
      expect((await driverSettlements(s.driverCtx, period)).period_totals.pending_supply).toBe(140000);
      const summary = await getSummary(s.adminCtx, {
        from: period.periodStart,
        to: period.periodEnd,
        include: 'all',
      });
      expect(summary.drivers.find((row) => row.id === s.driver.id)?.pending_supply).toBe(140000);
      expect(summary.projects.find((row) => row.id === s.project.id)?.pending_supply).toBe(140000);
      const candidates = await statementCandidates(s.adminCtx, {
        ...period,
        direction: 'PAYABLE',
        counterpartyId: s.payee.id,
      });
      expect(candidates.rows[0]).toMatchObject({
        estimated_supply: 140000,
        eligible: false,
        snapshot: { supply_amount: null },
      });
      const approved = await approveUse(s.adminCtx, use.id, { version: use.version });
      expect(approved.charge_lines[0]).toMatchObject({ approved_amount: 140000, tax_amount: 14000 });
      expect((await getLedger(s.adminCtx, { use_id: use.id })).totals.filteredSum).toBe(140000);
      expect((await driverSettlements(s.driverCtx, period)).period_totals.approved_supply).toBe(140000);
      expect((await getDashboard(s.adminCtx)).unsettled_approved_amount).toBeGreaterThanOrEqual(140000);
      const ready = await statementCandidates(s.adminCtx, {
        ...period,
        direction: 'PAYABLE',
        counterpartyId: s.payee.id,
      });
      expect(ready.rows[0]).toMatchObject({
        eligible: true,
        estimated_supply: 140000,
        snapshot: { supply_amount: 140000, tax_amount: 14000 },
      });
      const statement = await confirmed(s, [line.id]);
      expect(statement).toMatchObject({ supply_total: 140000, tax_total: 14000, grand_total: 154000 });
      await expect(
        updateUse(s.driverCtx, use.id, {
          version: approved.version,
          charge_lines: [{ ...base(150000), id: line.id }],
        }),
      ).rejects.toMatchObject({ code: 'STATEMENT_LOCKED' });
    },
  );

  it.each(['VAT_INCLUDED', 'VAT_EXCLUDED', 'TAX_EXEMPT'] as const)(
    '%s: 요청액의 세금 환산과 담당자 승인 공급가 우선',
    async (tax_mode) => {
      const s = await fixture();
      await database().db.update(rateAgreements).set({ tax_mode }).where(eq(rateAgreements.id, s.rate.id));
      const use = await submit(s, 140005);
      const expected = calculateTax(140005, tax_mode);
      expect((await getLedger(s.adminCtx, { use_id: use.id })).rows[0].review_base_amount).toBe(
        expected.supply,
      );
      expect((await driverSettlements(s.driverCtx, period)).period_totals.pending_supply).toBe(
        expected.supply,
      );
      expect(
        (
          await getSummary(s.adminCtx, { from: period.periodStart, to: period.periodEnd, include: 'all' })
        ).drivers.find((row) => row.id === s.driver.id)?.pending_supply,
      ).toBe(expected.supply);
      const approved = await approveUse(s.adminCtx, use.id, { version: use.version });
      expect(approved.charge_lines[0]).toMatchObject({
        approved_amount: expected.supply,
        tax_amount: expected.tax,
      });
      const override = await submit(s, 140005);
      const overridden = await approveUse(s.adminCtx, override.id, {
        version: override.version,
        lines: [{ id: override.charge_lines[0].id, approved_amount: 120000, line_review_status: 'APPROVED' }],
      });
      expect(overridden.charge_lines[0]).toMatchObject({
        approved_amount: 120000,
        tax_amount: tax_mode === 'TAX_EXEMPT' ? 0 : 12000,
      });
    },
  );

  it('미입력은 미정, 0원은 확정이며 요청액 삭제는 계약액으로 복귀한다', async () => {
    const s = await fixture(false);
    const unknown = await submit(s);
    expect(unknown.charge_lines[0].price_status).toBe('PENDING');
    expect((await getLedger(s.adminCtx, { use_id: unknown.id })).rows[0].review_total_amount).toBeNull();
    await expect(approveUse(s.adminCtx, unknown.id, { version: unknown.version })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    const zero = await submit(s, 0);
    expect((await approveUse(s.adminCtx, zero.id, { version: zero.version })).charge_lines[0]).toMatchObject({
      approved_amount: 0,
      tax_amount: 0,
      price_status: 'CONFIRMED',
    });
    const contract = await fixture();
    const entered = await createUse(contract.driverCtx, { ...contract.input, charge_lines: [base(170000)] });
    const cleared = await updateUse(contract.driverCtx, entered.id, {
      version: entered.version,
      charge_lines: [{ ...base(null), id: entered.charge_lines[0].id }],
    });
    expect(proposedAmount(cleared.charge_lines[0])).toBe(300000);
    expect(cleared.charge_lines[0].requested_amount).toBeNull();
  });

  it('권한·입력 검증·버전·멱등·감사 및 승인 후 수정 규칙을 유지한다', async () => {
    const s = await fixture(false);
    const input = { ...s.input, client_request_id: randomUUID(), charge_lines: [base(140000)] };
    const use = await createUse(s.driverCtx, input);
    expect((await createUse(s.driverCtx, input)).id).toBe(use.id);
    await expect(createUse(s.driverCtx, { ...input, charge_lines: [base(150000)] })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_MISMATCH',
    });
    const other = await s.f.driver();
    const user = await s.f.user({ role: 'DRIVER', driver_id: other.id });
    await s.f.assignment(user.id, s.project.id);
    await expect(
      updateUse(s.f.context(user), use.id, { version: use.version, charge_lines: [base(10)] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    for (const value of [-1, 1.5, 2147483648])
      await expect(createUse(s.driverCtx, { ...s.input, charge_lines: [base(value)] })).rejects.toThrow();
    const submitted = await submitUse(s.driverCtx, use.id, { version: use.version });
    const approved = await approveUse(s.adminCtx, use.id, { version: submitted.version });
    await expect(
      updateUse(s.driverCtx, use.id, { version: use.version, charge_lines: [base(150000)] }),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    const changed = await updateUse(s.driverCtx, use.id, {
      version: approved.version,
      charge_lines: [{ ...base(150000), id: approved.charge_lines[0].id }],
    });
    expect(changed).toMatchObject({ review_status: 'DRAFT', approved_revision_id: null });
    expect(changed.charge_lines[0]).toMatchObject({
      requested_amount: 150000,
      approved_amount: null,
      version: approved.charge_lines[0].version + 2,
    });
    const logs = await database()
      .db.select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entity_id, use.id), eq(auditLogs.action, 'UPDATE')));
    expect(JSON.stringify(logs)).toContain('150000');
    const proxy = await createUse(s.adminCtx, { ...s.input, charge_lines: [base(130000)] });
    expect(proxy).toMatchObject({
      entered_as: 'PROXY',
      charge_lines: [expect.objectContaining({ requested_amount: 130000 })],
    });
  });

  it('최근 경로는 본인의 가장 최근 제출만 참고하고 미제출·다른 기사·청구 금액을 제외한다', async () => {
    const s = await fixture(false);
    await submit(s, 120000);
    const latest = await submit(s, 140000);
    await updateUse(s.driverCtx, latest.id, {
      version: latest.version,
      charge_lines: [{ ...base(777000), id: latest.charge_lines[0].id }],
    });
    await createUse(s.driverCtx, { ...s.input, charge_lines: [base(990000)] });
    const other = await s.f.driver();
    await s.f.affiliation(other.id, s.payee.id);
    const hidden = await createUse(s.adminCtx, {
      ...s.input,
      driver_id: other.id,
      charge_lines: [base(880000)],
    });
    await submitUse(s.adminCtx, hidden.id, { version: hidden.version });
    const rows = await getRecentRoutes(s.driverCtx, { driver_id: s.driver.id });
    expect(rows[0]).toMatchObject({ origin: '상차장', destination: '현장', last_amount: 140000 });
    await expect(getRecentRoutes(s.driverCtx, { driver_id: other.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('엑셀 단가 열은 수량을 곱한 제안액으로 유지하고 계약 차이는 검수 이슈로 표시한다', async () => {
    const s = await fixture();
    const bytes = Buffer.from(
      `사용일,현장,기사,차량번호,지급처,출발지,도착지,과금단위,청구수량,단가\n2026-09-15,${s.project.code},${s.driver.id},${s.vehicle.plate_no},${s.payee.id},둔포,P5,일대,1,140000`,
    );
    const job = await uploadImport(s.adminCtx, '금액.csv', bytes);
    await previewImport(s.adminCtx, job.id, { sheet: 0, header_row: 1, mapping: job.sheets[0].mapping });
    const result = await commitImport(s.adminCtx, job.id);
    let use = await getUse(s.adminCtx, result.preview[0].use_id!);
    use = await updateUse(s.adminCtx, use.id, {
      version: use.version,
      reviewer_user_id: s.admin.id,
      load_tonnage: '1',
    });
    expect(use.charge_lines[0]).toMatchObject({
      unit_price: 140000,
      computed_amount: 140000,
      requested_amount: null,
      agreement_snapshot: { contract_computed_amount: 300000 },
    });
    expect((await getLedger(s.adminCtx, { use_id: use.id })).rows[0]).toMatchObject({
      review_base_amount: 140000,
      has_base_amount_difference: true,
    });
    const submitted = await submitUse(s.adminCtx, use.id, { version: use.version });
    expect(
      (await approveUse(s.adminCtx, use.id, { version: submitted.version })).charge_lines[0].approved_amount,
    ).toBe(140000);
  });
});
