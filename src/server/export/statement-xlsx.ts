import Decimal from 'decimal.js';
import ExcelJS from 'exceljs';
import { exportHeaders, rowValues, type StatementExportModel } from './statement-model';
export async function renderStatementXlsx(model: StatementExportModel) {
  const book = new ExcelJS.Workbook();
  book.creator = String(model.issuer.name ?? '');
  const sheet = book.addWorksheet('정산명세', {
    views: [{ state: 'frozen', ySplit: 10 }],
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: '1:10',
    },
    headerFooter: {
      oddHeader: model.draft ? '&C초안' : model.canceled ? '&C취소 명세' : '',
      oddFooter: '&R&P / &N',
    },
  });
  sheet.columns = [15, 22, 20, 18, 14, 26, 18, 9, 12, 12, 16, 18, 15, 34].map((width) => ({ width }));
  const mergeRow = (row: number, text: string) => {
    sheet.mergeCells(row, 1, row, exportHeaders.length);
    sheet.getCell(row, 1).value = text;
    sheet.getRow(row).height = 25;
  };
  mergeRow(1, `${model.draft ? '초안 · ' : model.canceled ? '취소 · ' : ''}${model.title}`);
  sheet.getCell('A1').font = { name: '맑은 고딕', size: 20, bold: true, color: { argb: 'FF15394B' } };
  sheet.getRow(1).height = 40;
  mergeRow(2, `문서번호: ${model.document_no}`);
  mergeRow(
    3,
    `거래 상대방: ${model.counterparty.name ?? ''}   사업자번호: ${model.counterparty.biz_no ?? ''}`,
  );
  mergeRow(
    4,
    `발행 회사: ${model.issuer.name ?? ''}   사업자번호: ${model.issuer.biz_no ?? ''}   대표자: ${model.issuer.representative ?? ''}`,
  );
  mergeRow(5, `회사 주소: ${model.issuer.address ?? ''}`);
  mergeRow(6, `정산 기간: ${model.period}   예정일: ${model.due_date}`);
  mergeRow(7, `발행일: ${model.issued_on}   확정 시각: ${model.confirmed_at}`);
  mergeRow(8, `담당자: ${model.contact}   연락처: ${model.issuer.settlement_contact ?? ''}`);
  if (model.draft) mergeRow(9, '초안 — 확정 전 금액이며 지급·청구 근거로 사용할 수 없습니다.');
  sheet.getRow(10).values = exportHeaders;
  sheet.getRow(10).height = 28;
  sheet.getRow(10).eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF15394B' } };
    cell.font = { name: '맑은 고딕', bold: true, color: { argb: 'FFFFFFFF' } };
  });
  for (const source of model.rows) {
    const values = rowValues(source);
    if (source.quantity !== null) values[9] = Number(source.quantity);
    const row = sheet.addRow(values);
    row.height = Math.max(
      32,
      Math.min(
        409,
        16 * Math.ceil(Math.max(String(values[5] ?? '').length / 18, String(values[13] ?? '').length / 25)),
      ),
    );
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.font = { name: '맑은 고딕', size: 10 };
      cell.alignment = {
        vertical: 'middle',
        wrapText: true,
        horizontal: col >= 8 && col <= 13 ? 'right' : 'left',
      };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFDDE4EB' } } };
      if (col >= 11 && col <= 13) cell.numFmt = '#,##0"원"';
      if (col === 10) {
        const places = new Decimal(source.quantity ?? 0).decimalPlaces();
        cell.numFmt = '#,##0' + (places ? '.' + '0'.repeat(places) : '');
      }
    });
  }
  sheet.addRow([]);
  for (const [label, amount] of [
    ['공급가 합계', model.supply_total],
    ['세액 합계', model.tax_total],
    ['총액', model.grand_total],
  ] as const) {
    const row = sheet.addRow([]);
    sheet.mergeCells(row.number, 1, row.number, 11);
    row.getCell(1).value = label;
    sheet.mergeCells(row.number, 12, row.number, exportHeaders.length);
    row.getCell(12).value = amount;
    row.getCell(12).numFmt = '#,##0"원"';
    row.height = 30;
    row.font = { name: '맑은 고딕', bold: true, size: label === '총액' ? 14 : 11 };
  }
  mergeRow(sheet.rowCount + 2, '작성 확인: ____________________    거래 상대방 확인: ____________________');
  mergeRow(sheet.rowCount + 1, model.disclaimer);
  return Buffer.from(await book.xlsx.writeBuffer());
}
