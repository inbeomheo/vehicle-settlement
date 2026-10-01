import { it, expect, vi, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { confirmed } from './W4-fixtures';
import { createUse, submitUse, approveUse, updateUse, getUse } from '../../src/server/services/uses';
import { getLedger } from '../../src/server/services/ledger';
import { getSummary } from '../../src/server/services/summary';
import { getApprovals } from '../../src/server/services/approvals';
import { exportApprovals } from '../../src/server/services/approvals-export';
import { exportLedger } from '../../src/server/services/ledger-export';
import { getRecentRoutes } from '../../src/server/services/ledger-recent';
import { driverSettlements } from '../../src/server/services/statements-driver';
import { rateAgreements, users } from '../../src/server/db/schema';
import { extractPdfText } from '../helpers/pdf';
import { renderStatementPdf } from '../../src/server/export/statement-pdf';
import { renderStatementXlsx } from '../../src/server/export/statement-xlsx';
import { statementExportModel, rowValues } from '../../src/server/export/statement-model';
import { quickApprovable, approveUse as quickApprove } from '../../src/components/manager/quick-approval';
const transport = vi.hoisted(() => ({ api: vi.fn(), mutate: vi.fn() }));
vi.mock('../../src/components/manager/common', () => transport);
const database = testDatabase();
const period = { from: '2026-09-01', to: '2026-09-30' };
afterEach(() => vi.clearAllMocks());
async function submitted(
  s: Awaited<ReturnType<typeof setupScenario>>,
  amount: number,
  projectId = s.project.id,
  quantity = '1',
) {
  const use = await createUse(s.driverCtx, {
    ...s.input,
    project_id: projectId,
    quantity,
    charge_lines: [{ charge_type: 'BASE', quantity, requested_amount: amount }],
  });
  return submitUse(s.driverCtx, use.id, { version: use.version });
}
it('목록을 본 뒤 금액이 변경되면 최신 버전으로 바꿔 승인하지 않는다', async () => {
  const s = await setupScenario(database().db);
  const original = await submitted(s, 300000);
  const shown = (await getLedger(s.adminCtx, { use_id: original.id })).rows[0];
  expect(quickApprovable(shown)).toBe(true);
  await updateUse(s.adminCtx, original.id, {
    version: original.version,
    charge_lines: [{ id: original.charge_lines[0].id, charge_type: 'BASE', requested_amount: 900000 }],
  });
  transport.api.mockImplementation(() => getUse(s.adminCtx, original.id));
  transport.mutate.mockImplementation((_url, _method, body) => approveUse(s.adminCtx, original.id, body));
  await expect(quickApprove(shown)).rejects.toMatchObject({
    status: 409,
    message: '내용이 바뀌었습니다. 다시 확인한 뒤 승인하세요.',
  });
  expect(transport.api).not.toHaveBeenCalled();
  expect((await getUse(s.adminCtx, original.id)).review_status).toBe('SUBMITTED');
});
it('같은 경로라도 현장별 마지막 제출 금액을 가져온다', async () => {
  const s = await setupScenario(database().db);
  await database().db.update(rateAgreements).set({ active: false }).where(eq(rateAgreements.id, s.rate.id));
  const b = await s.f.project({ name: '다른 현장' });
  await s.f.assignment(s.driverUser.id, b.id);
  await submitted(s, 100000);
  const other = await submitted(s, 900000, b.id);
  await updateUse(s.adminCtx, other.id, {
    version: other.version,
    charge_lines: [{ id: other.charge_lines[0].id, charge_type: 'BASE', requested_amount: 800000 }],
  });
  const routes = await getRecentRoutes(s.driverCtx, { driver_id: s.driver.id });
  expect(routes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ project_id: s.project.id, last_amount: 100000 }),
      expect.objectContaining({ project_id: b.id, last_amount: 800000 }),
    ]),
  );
});
it.each([
  { quantity: '1', amount: 140000, price: 140000 },
  { quantity: '3', amount: 140000, price: '—' },
  { quantity: '0.5', amount: 140000, price: 280000 },
  { quantity: '1', amount: 0, price: 0 },
])('승인 공급가의 실제 적용 단가: $quantity / $amount', async ({ quantity, amount, price }) => {
  const s = await setupScenario(database().db);
  const use = await submitted(s, amount, s.project.id, quantity);
  const approved = await approveUse(s.adminCtx, use.id, { version: use.version });
  const st = await confirmed(s, [approved.charge_lines[0].id]);
  const model = await statementExportModel(s.adminCtx, st.id);
  expect(rowValues(model.rows[0])[10]).toBe(price);
  expect(rowValues(model.rows[0])[11]).toBe(amount);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await renderStatementXlsx(model)) as unknown as ExcelJS.Buffer);
  expect(book.worksheets[0].getRow(11).getCell(11).value).toBe(price);
  expect(book.worksheets[0].getRow(11).getCell(12).value).toBe(amount);
  const pdfText = extractPdfText(await renderStatementPdf(model));
  const baseRow = pdfText.split('\n').find((line) => line.includes('기본운임'))!;
  expect(baseRow).toContain(typeof price === 'number' ? price.toLocaleString('ko-KR') : price);
  expect(baseRow).not.toContain('300,000');
});
it('명시적 0원은 미정 항목으로 집계하지 않는다', async () => {
  const s = await setupScenario(database().db);
  await database().db.update(rateAgreements).set({ active: false }).where(eq(rateAgreements.id, s.rate.id));
  const use = await submitted(s, 0);
  const data = await driverSettlements(s.driverCtx, { periodStart: period.from, periodEnd: period.to });
  expect(data.uses.find((row) => row.id === use.id)).toMatchObject({
    pending_supply: 0,
    pending_count: 1,
    unpriced_count: 0,
  });
});
it('담당자 이름 변경 뒤에도 집계·대장·결재 및 엑셀은 당시 이름, 필터는 ID를 유지한다', async () => {
  const s = await setupScenario(database().db);
  const use = await submitted(s, 300000);
  await approveUse(s.adminCtx, use.id, { version: use.version });
  await database().db.update(users).set({ name: '새 담당자 이름' }).where(eq(users.id, s.admin.id));
  const expected = s.admin.name;
  const filter = { ...period, project_id: s.project.id, reviewer_user_id: s.admin.id };
  expect(
    (await getSummary(s.adminCtx, period)).projects.find((p) => p.id === s.project.id)?.reviewers,
  ).toEqual([expected]);
  expect((await getLedger(s.adminCtx, filter)).rows[0].reviewer_name).toBe(expected);
  expect((await getApprovals(s.adminCtx, filter)).rows[0]).toMatchObject({ reviewer_name: expected });
  for (const [bytes, column] of [
    [await exportLedger(s.adminCtx, filter), 28],
    [await exportApprovals(s.adminCtx, filter), 7],
  ] as const) {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    expect(book.worksheets[0].getRow(2).getCell(column).value).toBe(expected);
  }
});
it.each(['difference', 'unknown', 'extra', 'shown_amount'] as const)(
  '서버는 현재 버전이어도 바로 승인 조건을 재검사한다: %s',
  async (issue) => {
    const s = await setupScenario(database().db);
    if (issue === 'unknown')
      await database()
        .db.update(rateAgreements)
        .set({ active: false })
        .where(eq(rateAgreements.id, s.rate.id));
    const created = await createUse(s.driverCtx, {
      ...s.input,
      charge_lines: [
        {
          charge_type: 'BASE',
          requested_amount: issue === 'difference' ? 900000 : issue === 'unknown' ? null : 300000,
        },
        ...(issue === 'extra'
          ? [{ charge_type: 'TOLL' as const, requested_amount: 10000, reason: '통행료' }]
          : []),
      ],
    });
    const use = await submitUse(s.driverCtx, created.id, { version: created.version });
    const shown = (await getLedger(s.adminCtx, { use_id: use.id })).rows[0];
    await expect(
      approveUse(s.adminCtx, use.id, {
        version: use.version,
        quick_approval: {
          review_base_amount: shown.review_base_amount ?? 0,
          review_extra_amount: shown.review_extra_amount ?? 0,
          review_total_amount: issue === 'shown_amount' ? 1 : (shown.review_total_amount ?? 0),
        },
      }),
    ).rejects.toMatchObject({ status: 409, message: '내용이 바뀌었습니다. 다시 확인한 뒤 승인하세요.' });
    expect((await getUse(s.adminCtx, use.id)).review_status).toBe('SUBMITTED');
  },
);
it.each(['VAT_INCLUDED', 'VAT_EXCLUDED', 'TAX_EXEMPT'] as const)(
  '계약대로 승인하면 세금 모드 %s의 계약 단가를 유지한다',
  async (taxMode) => {
    const s = await setupScenario(database().db);
    await database()
      .db.update(rateAgreements)
      .set({ tax_mode: taxMode, min_charge: 400000 })
      .where(eq(rateAgreements.id, s.rate.id));
    const created = await createUse(s.driverCtx, s.input);
    const submittedUse = await submitUse(s.driverCtx, created.id, { version: created.version });
    const approved = await approveUse(s.adminCtx, created.id, { version: submittedUse.version });
    const st = await confirmed(s, [approved.charge_lines[0].id]);
    const model = await statementExportModel(s.adminCtx, st.id);
    expect(rowValues(model.rows[0])[10]).toBe(300000);
  },
);
it('같은 목록 버전의 동시 바로 승인은 한 번만 반영한다', async () => {
  const s = await setupScenario(database().db);
  const use = await submitted(s, 300000);
  const row = (await getLedger(s.adminCtx, { use_id: use.id })).rows[0];
  const input = {
    version: row.version,
    quick_approval: {
      review_base_amount: row.review_base_amount!,
      review_extra_amount: row.review_extra_amount!,
      review_total_amount: row.review_total_amount!,
    },
  };
  const results = await Promise.allSettled([
    approveUse(s.adminCtx, use.id, input),
    approveUse(s.adminCtx, use.id, input),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.find((result) => result.status === 'rejected')).toMatchObject({
    reason: { status: 409, message: '내용이 바뀌었습니다. 다시 확인한 뒤 승인하세요.' },
  });
  expect((await getUse(s.adminCtx, use.id)).charge_lines[0].approved_amount).toBe(300000);
});
it('제출 후 현장만 바꾼 미제출 초안은 이전 현장 금액을 새 현장에 채우지 않는다', async () => {
  const s = await setupScenario(database().db);
  const other = await s.f.project();
  await s.f.assignment(s.driverUser.id, other.id);
  const use = await submitted(s, 100000);
  await updateUse(s.driverCtx, use.id, { version: use.version, project_id: other.id });
  expect(await getRecentRoutes(s.driverCtx, { driver_id: s.driver.id })).toEqual(
    expect.arrayContaining([expect.objectContaining({ project_id: other.id, last_amount: null })]),
  );
});
