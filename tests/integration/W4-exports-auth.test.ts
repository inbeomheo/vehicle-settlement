import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { testOutputDirectory } from '../helpers/output';
import { eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  chargeLines,
  companySettings,
  counterparties,
  drivers,
  projectAssignments,
  rateAgreements,
  vehicleUses,
  vehicles,
} from '../../src/server/db/schema';
import { statementExportModel } from '../../src/server/export/statement-model';
import { renderStatementXlsx } from '../../src/server/export/statement-xlsx';
import { renderStatementPdf } from '../../src/server/export/statement-pdf';
import { driverSettlements } from '../../src/server/services/statements-driver';
import { confirmStatement, getStatement, listStatements } from '../../src/server/services/statements';
import { recordPayment } from '../../src/server/services/payments';
import { GET as xlsxRoute } from '../../src/app/api/statements/[id]/export.xlsx/route';
import { GET as pdfRoute } from '../../src/app/api/statements/[id]/export.pdf/route';
import { GET as detailRoute } from '../../src/app/api/statements/[id]/route';
import { GET as mineRoute } from '../../src/app/api/statements/mine/route';
import { POST as paymentRoute } from '../../src/app/api/statements/[id]/payments/route';
import { testDatabase } from '../helpers/database';
import { callRoute } from '../helpers/routes';
import { approved, confirmed, draft, scenario } from './W4-fixtures';
const database = testDatabase();
describe('W4 스냅샷 출력과 권한', () => {
  it('기준정보·단가 변경 및 원자료 훼손에도 확정 화면/XLSX/PDF 모델과 금액은 고정', async (test) => {
    const s = await scenario(database().db);
    const company = await s.f.company({ name: '한글 회사', settlement_contact: '02-1111-2222' });
    const use = await approved(s, {
      cargo_desc: '철근 운반',
      trips: [{ seq: 1, origin: '공장', destination: '현장' }],
    });
    const statement = await confirmed(
      s,
      use.charge_lines.map((l) => l.id),
    );
    const original = await statementExportModel(s.adminCtx, statement.id);
    await database()
      .db.update(counterparties)
      .set({ name: '새 운송사명' })
      .where(eq(counterparties.id, s.payee.id));
    await database().db.update(drivers).set({ name: '새 기사명' }).where(eq(drivers.id, s.driver.id));
    await database()
      .db.update(vehicles)
      .set({ plate_no: `새번호-${randomUUID().slice(0, 8)}` })
      .where(eq(vehicles.id, s.vehicle.id));
    await database()
      .db.update(companySettings)
      .set({ name: '변경 회사' })
      .where(eq(companySettings.id, company.id));
    await s.f.rate(s.payee.id, { unit_price: 900000, valid_from: '2026-10-01' });
    await database()
      .db.update(rateAgreements)
      .set({ valid_to: '2026-09-30' })
      .where(eq(rateAgreements.id, s.rate.id));
    // Simulate an out-of-band write: frozen export must not read these mutable values.
    await database()
      .db.update(vehicleUses)
      .set({ cargo_desc: '훼손된 원자료', use_date: '2026-10-10' })
      .where(eq(vehicleUses.id, use.id));
    await database()
      .db.update(chargeLines)
      .set({ approved_amount: 123, tax_amount: 5 })
      .where(eq(chargeLines.id, use.charge_lines[0].id));
    const model = await statementExportModel(s.adminCtx, statement.id);
    expect(model).toEqual(original);
    expect((await getStatement(s.adminCtx, statement.id)).grand_total).toBe(300000);
    const xlsx = await renderStatementXlsx(model);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsx as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.getWorksheet('정산명세')!;
    expect(sheet.getCell('A11').value).toBe('2026-09-15');
    expect(sheet.getCell('L11').value).toBe(300000);
    expect(sheet.getCell('M11').value).toBe(0);
    expect(sheet.getCell('A12').value).toBeNull();
    let grandTotal = -1;
    sheet.eachRow((row) => {
      if (row.getCell(1).value === '총액') grandTotal = Number(row.getCell(12).value);
    });
    expect(grandTotal).toBe(model.grand_total);
    expect(model.document_no).toBe(statement.statement_no);
    const pdf = await renderStatementPdf(model);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(10000);
    if (process.env.W4_RENDER_QA) {
      const output = await testOutputDirectory(test, 'w4-statement');
      await writeFile(join(output, 'statement.pdf'), pdf);
      await writeFile(join(output, 'statement.xlsx'), xlsx);
    }
  });
  it('초안 출력은 초안 표기, 긴 내용과 여러 페이지 PDF 생성', async (test) => {
    const s = await scenario(database().db);
    const use = await approved(s);
    const statement = await draft(
      s,
      use.charge_lines.map((l) => l.id),
    );
    const model = await statementExportModel(s.adminCtx, statement.id);
    expect(model.draft).toBe(true);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      (await renderStatementXlsx(model)) as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    expect(workbook.worksheets[0].getCell('A1').value).toContain('초안');
    expect(workbook.worksheets[0].headerFooter.oddHeader).toContain('초안');
    const long = {
      ...model,
      supply_total: model.supply_total * 35,
      tax_total: model.tax_total * 35,
      grand_total: model.grand_total * 35,
      rows: Array.from({ length: 35 }, (_, i) => ({
        ...model.rows[0],
        notes: i === 0 ? '긴 비고 한글 '.repeat(150) : '운반 내역 확인',
        carried_forward: true,
      })),
    };
    const pdf = await renderStatementPdf(long);
    expect(pdf.length).toBeGreaterThan(20000);
    if (process.env.W4_RENDER_QA) {
      const output = await testOutputDirectory(test, 'w4-multipage');
      await writeFile(join(output, 'draft-multipage.pdf'), pdf);
    }
  });
  it('기사 정산은 본인 PAYABLE 항목 금액만, 타 기사·전체 명세·export URL은 404', async () => {
    const s = await scenario(database().db);
    const customer = await s.f.counterparty({ kind: 'CUSTOMER', name: '숨겨진 고객' });
    await s.f.rate(customer.id, { direction: 'RECEIVABLE', unit_price: 999999, tax_mode: 'TAX_EXEMPT' });
    const mine = await approved(s, { customer_counterparty_id: customer.id });
    const otherDriver = await s.f.driver({ name: '다른 기사' });
    await s.f.affiliation(otherDriver.id, s.payee.id);
    const other = await approved(s, { driver_id: otherDriver.id });
    const shared = await confirmed(
      s,
      [...mine.charge_lines.filter((l) => l.direction === 'PAYABLE'), ...other.charge_lines].map((l) => l.id),
    );
    const bill = await draft(
      s,
      mine.charge_lines.filter((l) => l.direction === 'RECEIVABLE').map((l) => l.id),
      { direction: 'RECEIVABLE', counterparty_id: customer.id },
    );
    await confirmStatement(s.adminCtx, bill.id, { confirmation_token: bill.confirmation_token!, version: 1 });
    await recordPayment(s.adminCtx, shared.id, {
      client_request_id: randomUUID(),
      kind: 'PAYMENT',
      amount: 600000,
      paid_on: '2026-09-29',
      method: '현금',
    });
    const detail = await driverSettlements(s.driverCtx, {
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
    });
    expect(detail.statements).toHaveLength(1);
    expect(detail.statements[0]).toMatchObject({ grand_total: 300000, paid: true });
    expect(detail.statements[0].items).toHaveLength(1);
    expect(JSON.stringify(detail)).not.toMatch(/RECEIVABLE|999999|600000|다른 기사|숨겨진 고객/);
    const { token } = await s.f.session(s.driverUser.id);
    for (const route of [xlsxRoute, pdfRoute, detailRoute]) {
      const response = await callRoute(database().db, route, {
        token,
        params: { id: shared.id },
        path: `/api/statements/${shared.id}`,
      });
      expect(response.status).toBe(404);
    }
    const mineResponse = await callRoute(database().db, mineRoute, {
      token,
      path: '/api/statements/mine?periodStart=2026-09-01&periodEnd=2026-09-30',
    });
    expect(mineResponse.status).toBe(200);
    expect(JSON.stringify(await mineResponse.json())).not.toContain('RECEIVABLE');
    await database()
      .db.update(projectAssignments)
      .set({ revoked_at: new Date() })
      .where(eq(projectAssignments.id, s.assignment.id));
    expect(
      (await driverSettlements(s.driverCtx, { periodStart: '2026-09-01', periodEnd: '2026-09-30' }))
        .statements,
    ).toHaveLength(0);
  });
  it('담당자 현장 범위와 권한 회수는 목록·상세·출력·멱등 응답 재생에도 적용', async () => {
    const s = await scenario(database().db);
    const use = await approved(s);
    const statement = await confirmed(
      s,
      use.charge_lines.map((l) => l.id),
    );
    const user = await s.f.user({ role: 'SETTLEMENT_MANAGER' });
    const assignment = await s.f.assignment(user.id, s.project.id);
    const ctx = s.f.context(user);
    const { token } = await s.f.session(user.id);
    const opts = {
      method: 'POST',
      token,
      path: `/api/statements/${statement.id}/payments`,
      params: { id: statement.id },
      body: {
        client_request_id: randomUUID(),
        kind: 'PAYMENT',
        amount: 300000,
        paid_on: '2026-09-29',
        method: '현금',
      },
      headers: { 'idempotency-key': randomUUID() },
    };
    expect((await callRoute(database().db, paymentRoute, opts)).status).toBe(200);
    for (const route of [xlsxRoute, pdfRoute])
      expect((await callRoute(database().db, route, { token, params: { id: statement.id } })).status).toBe(
        200,
      );
    await database()
      .db.update(projectAssignments)
      .set({ revoked_at: new Date() })
      .where(eq(projectAssignments.id, assignment.id));
    expect((await listStatements(ctx, {})).total).toBe(0);
    for (const route of [xlsxRoute, pdfRoute, detailRoute])
      expect((await callRoute(database().db, route, { token, params: { id: statement.id } })).status).toBe(
        404,
      );
    expect((await callRoute(database().db, paymentRoute, opts)).status).toBe(404);
  });
});
