import { expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { testOutputDirectory } from '../helpers/output';
import { testDatabase } from '../helpers/database';
import { scenario, approved, confirmed } from './W4-fixtures';
import { createUse } from '../../src/server/services/uses';
import { getLedger } from '../../src/server/services/ledger';
import { exportLedger } from '../../src/server/services/ledger-export';
import { statementExportModel, rowValues } from '../../src/server/export/statement-model';
import { renderStatementXlsx } from '../../src/server/export/statement-xlsx';
import { renderStatementPdf } from '../../src/server/export/statement-pdf';
const database = testDatabase();
it('12. 수량은 화면/Excel/PDF 모델에서 천 단위·소수 0 제거, snapshot은 유지', async (test) => {
  const s = await scenario(database().db);
  const use = await approved(s, {
    quantity: '2.5',
    trips: [{ seq: 1, origin: '항구', destination: '현장', quantity: '1234.5', quantity_unit: '톤' }],
  });
  const statement = await confirmed(
    s,
    use.charge_lines.map((c) => c.id),
  );
  const model = await statementExportModel(s.adminCtx, statement.id);
  expect(model.rows[0].quantity).toBe('2.500');
  expect(rowValues(model.rows[0])[9]).toBe('2.5');
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await renderStatementXlsx(model)) as unknown as ExcelJS.Buffer);
  expect(book.worksheets[0].getCell('J11').value).toBe(2.5);
  expect(book.worksheets[0].getCell('J11').numFmt).toContain('#,##0');
  const ledger = await getLedger(s.adminCtx, { use_id: use.id });
  expect(ledger.rows[0].performance).toContain('1,234.5톤');
  const ledgerBook = new ExcelJS.Workbook();
  await ledgerBook.xlsx.load(
    (await exportLedger(s.adminCtx, { use_id: use.id })) as unknown as ExcelJS.Buffer,
  );
  expect(ledgerBook.worksheets[0].getCell('O2').text).toContain('1,234.5톤');
  const output = await testOutputDirectory(test, 'w7-quantity');
  await writeFile(join(output, 'quantity.pdf'), await renderStatementPdf(model));
});
it('13. 반복 경로는 짧게 요약하고 승인 전 지급 기본/추가 금액·요청비 유무 제공', async () => {
  const s = await scenario(database().db);
  const use = await createUse(s.adminCtx, {
    ...s.input,
    trips: Array.from({ length: 3 }, (_, i) => ({
      seq: i + 1,
      origin: '인천 북항 야적장',
      destination: '서울 현장 1문',
    })),
    charge_lines: [
      { charge_type: 'BASE', billing_unit: 'PER_DAY' },
      { charge_type: 'TOLL', requested_amount: 5000, reason: '통행료' },
    ],
  });
  const row = (await getLedger(s.adminCtx, { use_id: use.id })).rows[0];
  expect(row).toMatchObject({
    route_summary: '인천 북항 야적장 → 서울 현장 1문 외 2회',
    review_base_amount: 300000,
    review_extra_amount: 5000,
    review_total_amount: 305000,
    has_requested_extra: true,
  });
  expect(row.base_amount).toBeNull(); // Ledger remains approved-supply only.
});
