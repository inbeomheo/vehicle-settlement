import { expect, it } from 'vitest';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { createUse, submitUse, approveUse, reviewChargeLine, getUse } from '../../src/server/services/uses';
import { getLedger, type LedgerRow } from '../../src/server/services/ledger';
import { getApprovals } from '../../src/server/services/approvals';
import { quickApprovable } from '../../src/shared/quick-approval';

const database = testDatabase();
const quick = (row: LedgerRow) => ({
  version: row.version,
  quick_approval: {
    review_base_amount: row.review_base_amount!,
    review_extra_amount: row.review_extra_amount!,
    review_total_amount: row.review_total_amount!,
  },
});
it('보류액은 승인 대상액과 분리하고 현재 버전의 바로 승인도 거부한다', async () => {
  const s = await setupScenario(database().db);
  let use = await createUse(s.driverCtx, {
    ...s.input,
    charge_lines: [
      { charge_type: 'BASE', requested_amount: 300000 },
      { charge_type: 'TOLL', requested_amount: 50000, reason: '통행료' },
    ],
  });
  use = await submitUse(s.driverCtx, use.id, { version: use.version });
  await reviewChargeLine(s.adminCtx, use.charge_lines.find((line) => line.charge_type === 'TOLL')!.id, {
    version: use.version,
    line_review_status: 'HELD',
    reason: '확인 대기',
  });
  const row = (await getLedger(s.adminCtx, { use_id: use.id })).rows[0];
  expect(quickApprovable(row)).toBe(false);
  expect(row).toMatchObject({
    review_total_amount: 300000,
    held_payable_amount: 50000,
    has_held_lines: true,
  });
  await expect(approveUse(s.adminCtx, use.id, quick(row))).rejects.toMatchObject({ status: 409 });
  const approved = await approveUse(s.adminCtx, use.id, { version: row.version });
  expect(approved.charge_lines.reduce((sum, line) => sum + (line.approved_amount ?? 0), 0)).toBe(300000);
});
it.each(['difference', 'unknown', 'no_contract'] as const)(
  '미승인 고객 청구 %s는 목록·결재·서버에서 바로 승인 불가',
  async (issue) => {
    const s = await setupScenario(database().db);
    const customer = await s.f.counterparty({ kind: 'CUSTOMER' });
    if (issue === 'difference') await s.f.rate(customer.id, { direction: 'RECEIVABLE', unit_price: 500000 });
    let use = await createUse(s.adminCtx, {
      ...s.input,
      customer_counterparty_id: customer.id,
      charge_lines: [
        { charge_type: 'BASE', direction: 'PAYABLE', requested_amount: 300000 },
        {
          charge_type: 'BASE',
          direction: 'RECEIVABLE',
          requested_amount: issue === 'unknown' ? null : 900000,
        },
      ],
    });
    use = await submitUse(s.adminCtx, use.id, { version: use.version });
    const row = (await getLedger(s.adminCtx, { use_id: use.id })).rows[0];
    expect(quickApprovable(row)).toBe(false);
    expect(row).toMatchObject({ receivable_needs_review: true });
    const approval = (
      await getApprovals(s.adminCtx, { from: use.use_date, to: use.use_date, project_id: s.project.id })
    ).rows[0] as LedgerRow;
    expect(quickApprovable(approval)).toBe(false);
    await expect(approveUse(s.adminCtx, use.id, quick(row))).rejects.toMatchObject({ status: 409 });
    expect(
      (await getUse(s.adminCtx, use.id)).charge_lines.every((line) => line.line_review_status === 'PENDING'),
    ).toBe(true);
  },
);

it.each([
  { tax_mode: 'VAT_EXCLUDED' as const, amount: 500000, supply: 500000 },
  { tax_mode: 'VAT_INCLUDED' as const, amount: 550000, supply: 500000 },
  { tax_mode: 'TAX_EXEMPT' as const, amount: 0, supply: 0 },
])(
  '계약 청구 $tax_mode $amount원은 표시 공급가까지 일치해야 바로 승인한다',
  async ({ tax_mode, amount, supply }) => {
    const s = await setupScenario(database().db);
    const customer = await s.f.counterparty({ kind: 'CUSTOMER' });
    await s.f.rate(customer.id, { direction: 'RECEIVABLE', unit_price: amount, tax_mode });
    let use = await createUse(s.adminCtx, { ...s.input, customer_counterparty_id: customer.id });
    use = await submitUse(s.adminCtx, use.id, { version: use.version });
    const row = (await getLedger(s.adminCtx, { use_id: use.id })).rows[0];
    expect(quickApprovable(row)).toBe(true);
    expect(row).toMatchObject({
      review_total_amount: 300000,
      review_receivable_amount: supply,
      receivable_needs_review: false,
    });
    // An older client that has not displayed the receivable cannot silently approve it.
    await expect(approveUse(s.adminCtx, use.id, quick(row))).rejects.toMatchObject({ status: 409 });
    await expect(
      approveUse(s.adminCtx, use.id, {
        ...quick(row),
        quick_approval: { ...quick(row).quick_approval, review_receivable_amount: supply + 1 },
      }),
    ).rejects.toMatchObject({ status: 409 });
    const approved = await approveUse(s.adminCtx, use.id, {
      ...quick(row),
      quick_approval: { ...quick(row).quick_approval, review_receivable_amount: supply },
    });
    expect(approved.charge_lines.find((line) => line.direction === 'RECEIVABLE')).toMatchObject({
      approved_amount: supply,
      line_review_status: 'APPROVED',
    });
    expect(
      (await getUse(s.driverCtx, use.id)).charge_lines.every((line) => line.direction === 'PAYABLE'),
    ).toBe(true);
  },
);
it.each(['APPROVED', 'HELD', 'REJECTED'] as const)(
  '고객 청구를 상세에서 %s 처리한 결과를 유지한다',
  async (status) => {
    const s = await setupScenario(database().db);
    const customer = await s.f.counterparty({ kind: 'CUSTOMER' });
    let use = await createUse(s.adminCtx, { ...s.input, customer_counterparty_id: customer.id });
    use = await submitUse(s.adminCtx, use.id, { version: use.version });
    await reviewChargeLine(s.adminCtx, use.charge_lines.find((line) => line.direction === 'RECEIVABLE')!.id, {
      version: use.version,
      line_review_status: status,
      ...(status === 'APPROVED' ? { approved_amount: 900000 } : {}),
      reason: '상세 확인',
    });
    const row = (await getLedger(s.adminCtx, { use_id: use.id })).rows[0];
    expect(row.receivable_needs_review).toBe(false);
    expect(quickApprovable(row)).toBe(status !== 'HELD');
    if (status === 'HELD') {
      expect(row).toMatchObject({
        has_held_receivable: true,
        held_receivable_amount: null,
        review_receivable_amount: null,
      });
      await expect(approveUse(s.adminCtx, use.id, quick(row))).rejects.toMatchObject({ status: 409 });
    } else {
      const approved = await approveUse(s.adminCtx, use.id, {
        ...quick(row),
        quick_approval: {
          ...quick(row).quick_approval,
          review_receivable_amount: row.review_receivable_amount,
        },
      });
      expect(approved.charge_lines.find((line) => line.direction === 'RECEIVABLE')?.line_review_status).toBe(
        status,
      );
    }
  },
);

it('기본운임 전체가 보류되어도 승인 대상 0원과 보류액을 구분한다', async () => {
  const s = await setupScenario(database().db);
  let use = await createUse(s.driverCtx, s.input);
  use = await submitUse(s.driverCtx, use.id, { version: use.version });
  await reviewChargeLine(s.adminCtx, use.charge_lines[0].id, {
    version: use.version,
    line_review_status: 'HELD',
    reason: '전체 확인 대기',
  });
  const row = (await getLedger(s.adminCtx, { use_id: use.id })).rows[0];
  expect(row).toMatchObject({ review_total_amount: 0, held_payable_amount: 300000 });
  expect(quickApprovable(row)).toBe(false);
});
