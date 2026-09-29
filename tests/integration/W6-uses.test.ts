import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { chargeLines } from '../../src/server/db/schema';
import {
  approveUse,
  createUse,
  getUse,
  reviewChargeLine,
  submitUse,
  updateUse,
} from '../../src/server/services/uses';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';

const database = testDatabase();

async function includedVatUse() {
  const scenario = await setupScenario(database().db);
  await scenario.f.rate(scenario.payee.id, {
    project_id: scenario.project.id,
    unit_price: 330005,
    tax_mode: 'VAT_INCLUDED',
  });
  const draft = await createUse(scenario.adminCtx, scenario.input);
  const use = await submitUse(scenario.adminCtx, draft.id, { version: draft.version });
  return { ...scenario, use };
}

describe('W6 사용 건 금액 회귀', () => {
  it.each(['PER_DAY', 'HALF_DAY', 'MONTHLY', 'LUMP_SUM'] as const)(
    '2. %s BASE quantity null은 운행 5건과 무관하게 수량 1·30만원 확정',
    async (billingUnit) => {
      const s = await setupScenario(database().db);
      if (billingUnit !== 'PER_DAY') {
        await s.f.rate(s.payee.id, { billing_unit: billingUnit });
      }
      const use = await createUse(s.driverCtx, {
        ...s.input,
        charge_lines: [{ charge_type: 'BASE', billing_unit: billingUnit, quantity: null }],
        trips: Array.from({ length: 5 }, (_, index) => ({
          seq: index + 1,
          origin: '골재장',
          destination: '건설 현장',
        })),
      });
      expect(use.trips).toHaveLength(5);
      expect(use.charge_lines).toHaveLength(1);
      expect(use.charge_lines[0]).toMatchObject({
        quantity: '1.000',
        computed_amount: 300000,
        price_status: 'CONFIRMED',
      });
    },
  );

  it('3. VAT 포함 330,005원 개별 승인 후 동일 공급가로 전체 승인해도 합계 보존', async () => {
    const s = await includedVatUse();
    const line = s.use.charge_lines[0];
    const reviewed = await reviewChargeLine(s.adminCtx, line.id, {
      version: s.use.version,
      line_review_status: 'APPROVED',
    });
    expect(reviewed).toMatchObject({ approved_amount: 300005, tax_amount: 30000 });
    const approved = await approveUse(s.adminCtx, s.use.id, {
      version: reviewed.use_version,
      lines: [{ id: line.id, line_review_status: 'APPROVED', approved_amount: 300005 }],
    });
    expect(approved.charge_lines[0]).toMatchObject({ approved_amount: 300005, tax_amount: 30000 });
    expect(approved.charge_lines[0].approved_amount! + approved.charge_lines[0].tax_amount!).toBe(330005);
  });

  it('3. 계약에서 계산된 공급가를 처음 보내도 VAT 포함 총액을 보존', async () => {
    const s = await includedVatUse();
    const approved = await approveUse(s.adminCtx, s.use.id, {
      version: s.use.version,
      lines: [{ id: s.use.charge_lines[0].id, line_review_status: 'APPROVED', approved_amount: 300005 }],
    });
    expect(approved.charge_lines[0]).toMatchObject({ approved_amount: 300005, tax_amount: 30000 });
  });

  it('3. 변경된 공급가 override는 10% 세액을 계산하고 후속 전체 승인에도 유지', async () => {
    const s = await includedVatUse();
    const reviewed = await reviewChargeLine(s.adminCtx, s.use.charge_lines[0].id, {
      version: s.use.version,
      line_review_status: 'APPROVED',
      approved_amount: 310000,
    });
    expect(reviewed).toMatchObject({ approved_amount: 310000, tax_amount: 31000 });
    const approved = await approveUse(s.adminCtx, s.use.id, {
      version: reviewed.use_version,
      lines: [{ id: reviewed.id, line_review_status: 'APPROVED' }],
    });
    expect(approved.charge_lines[0]).toMatchObject({ approved_amount: 310000, tax_amount: 31000 });
  });

  it.each([100000, -100000])(
    '6. 사용 내용 수정은 조정 공급가 %i원과 세액·승인을 초기화하지 않음',
    async (supply) => {
      const s = await includedVatUse();
      const approved = await approveUse(s.adminCtx, s.use.id, { version: s.use.version });
      // Legacy unlocked adjustment fixture: its computed amount is supply, never VAT-inclusive gross.
      const [adjustment] = await database()
        .db.insert(chargeLines)
        .values({
          vehicle_use_id: s.use.id,
          direction: 'PAYABLE',
          counterparty_id: s.payee.id,
          charge_type: 'ADJUSTMENT',
          billing_unit: 'LUMP_SUM',
          quantity: '1',
          unit_price: supply,
          rate_basis_date: '2026-10-01',
          tax_mode: 'VAT_INCLUDED',
          rounding: 'HALF_UP',
          computed_amount: supply,
          approved_amount: supply,
          tax_amount: supply / 10,
          price_status: 'CONFIRMED',
          line_review_status: 'APPROVED',
          reason: '기존 정산 차액 조정',
        })
        .returning();
      const changed = await updateUse(s.adminCtx, approved.id, {
        version: approved.version,
        notes: '운반 내용 메모 보완',
      });
      expect(changed.charge_lines.find((line) => line.id === adjustment.id)).toMatchObject({
        approved_amount: supply,
        tax_amount: supply / 10,
        line_review_status: 'APPROVED',
      });
      const reapproved = await approveUse(s.adminCtx, approved.id, { version: changed.version });
      expect(reapproved.charge_lines.find((line) => line.id === adjustment.id)).toMatchObject({
        approved_amount: supply,
        tax_amount: supply / 10,
      });
    },
  );

  it('6. 이전에 초기화된 VAT 포함 조정을 재승인할 때도 computed_amount는 공급가', async () => {
    const s = await includedVatUse();
    const [adjustment] = await database()
      .db.insert(chargeLines)
      .values({
        vehicle_use_id: s.use.id,
        direction: 'PAYABLE',
        counterparty_id: s.payee.id,
        charge_type: 'ADJUSTMENT',
        billing_unit: 'LUMP_SUM',
        quantity: '1',
        unit_price: -100000,
        rate_basis_date: '2026-10-01',
        tax_mode: 'VAT_INCLUDED',
        rounding: 'HALF_UP',
        computed_amount: -100000,
        price_status: 'CONFIRMED',
        reason: '기존 초기화 조정 복구',
      })
      .returning();
    await approveUse(s.adminCtx, s.use.id, { version: s.use.version });
    const result = await getUse(s.adminCtx, s.use.id);
    expect(result.charge_lines.find((line) => line.id === adjustment.id)).toMatchObject({
      approved_amount: -100000,
      tax_amount: -10000,
    });
    expect(
      (await database().db.select().from(chargeLines).where(eq(chargeLines.id, adjustment.id)))[0],
    ).toMatchObject({ approved_amount: -100000, tax_amount: -10000 });
  });
});
