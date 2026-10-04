import { expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { createUse, submitUse, approveUse, reviewChargeLine } from '../../src/server/services/uses';
import { getLedger } from '../../src/server/services/ledger';
import { getApprovals } from '../../src/server/services/approvals';
import { exportApprovals } from '../../src/server/services/approvals-export';
import { quickApprovable } from '../../src/shared/quick-approval';

const database = testDatabase();
const period = { from: '2026-09-01', to: '2026-09-30' };

it('보류 5만원은 결재 행·상단·엑셀의 30만원 합계에서 제외하고 별도로 표시한다', async () => {
  const s = await setupScenario(database().db);
  let use = await createUse(s.driverCtx, {
    ...s.input,
    charge_lines: [
      { charge_type: 'BASE', requested_amount: 300000 },
      { charge_type: 'TOLL', requested_amount: 50000, reason: '영수증 확인' },
    ],
  });
  use = await submitUse(s.driverCtx, use.id, { version: use.version });
  const review = await reviewChargeLine(
    s.adminCtx,
    use.charge_lines.find((l) => l.charge_type === 'TOLL')!.id,
    {
      version: use.version,
      line_review_status: 'HELD',
    },
  );
  await approveUse(s.adminCtx, use.id, { version: review.use_version });
  const query = { ...period, project_id: s.project.id, review_status: 'APPROVED' };
  const result = await getApprovals(s.adminCtx, query);
  expect(result.rows[0]).toMatchObject({ review_total_amount: 300000, held_payable_amount: 50000 });
  expect
    .soft(result.summary)
    .toMatchObject({ amount: 300000, unknown_count: 0, held_amount: 50000, held_unknown_count: 0 });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await exportApprovals(s.adminCtx, query)) as unknown as ExcelJS.Buffer);
  const sheet = book.worksheets[0];
  expect.soft(sheet.getCell('H3').value).toBe(300000);
  expect.soft(sheet.getCell('K1').value).toBe('보류 금액(공급가)');
  expect.soft(sheet.getCell('K2').value).toBe(50000);
  expect.soft(sheet.getCell('K3').value).toBe(50000);
});

it('기본운임 반려 + 통행료 개별 승인은 기본 0원·총 5만원으로 바로 승인한다', async () => {
  const s = await setupScenario(database().db);
  let use = await createUse(s.driverCtx, {
    ...s.input,
    charge_lines: [
      { charge_type: 'BASE', requested_amount: 300000 },
      { charge_type: 'TOLL', requested_amount: 50000, reason: '실비만 인정' },
    ],
  });
  use = await submitUse(s.driverCtx, use.id, { version: use.version });
  let review = await reviewChargeLine(
    s.adminCtx,
    use.charge_lines.find((l) => l.charge_type === 'BASE')!.id,
    {
      version: use.version,
      line_review_status: 'REJECTED',
    },
  );
  review = await reviewChargeLine(s.adminCtx, use.charge_lines.find((l) => l.charge_type === 'TOLL')!.id, {
    version: review.use_version,
    line_review_status: 'APPROVED',
  });
  const row = (await getLedger(s.adminCtx, { use_id: use.id })).rows[0];
  expect(row).toMatchObject({
    review_base_amount: 0,
    review_extra_amount: 50000,
    review_total_amount: 50000,
  });
  expect(quickApprovable(row)).toBe(true);
  expect(
    await approveUse(s.adminCtx, use.id, {
      version: review.use_version,
      quick_approval: {
        review_base_amount: 0,
        review_extra_amount: 50000,
        review_total_amount: 50000,
        review_receivable_amount: null,
      },
    }),
  ).toMatchObject({ review_status: 'APPROVED' });
});

it('대상 기본운임이 실제 미정일 때만 null이고, 보류 미정은 별도 개수로 센다', async () => {
  const s = await setupScenario(database().db);
  const use = await createUse(s.driverCtx, { ...s.input, billing_unit: 'PER_TRIP' });
  const before = (await getLedger(s.adminCtx, { use_id: use.id })).rows[0];
  expect(before).toMatchObject({ review_base_amount: null, review_total_amount: null });
  const { chargeLines } = await import('../../src/server/db/schema');
  const { eq } = await import('drizzle-orm');
  await database()
    .db.update(chargeLines)
    .set({ line_review_status: 'HELD' })
    .where(eq(chargeLines.vehicle_use_id, use.id));
  const held = await getApprovals(s.adminCtx, { ...period, project_id: s.project.id });
  expect(held.summary).toMatchObject({
    amount: 0,
    unknown_count: 0,
    held_amount: 0,
    held_count: 1,
    held_unknown_count: 1,
  });
  expect(held.rows[0]).toMatchObject({
    review_base_amount: 0,
    review_total_amount: 0,
    held_payable_amount: null,
  });
});
