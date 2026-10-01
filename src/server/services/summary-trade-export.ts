import ExcelJS from 'exceljs';
import Decimal from 'decimal.js';
import { eq } from 'drizzle-orm';
import type { Context } from '../context';
import { companySettings, counterparties } from '../db/schema';
import { sumMoney } from '../domain/money';
import { getSummary, summaryQuerySchema } from './summary';

export async function exportSummaryTrade(ctx: Context, raw: unknown) {
  const data = await getSummary(ctx, raw);
  const query = summaryQuerySchema.parse(raw);
  const [company] = await ctx.db.select().from(companySettings).limit(1);
  // A guessed payment recipient must never disclose an out-of-scope business identity.
  const visiblePayee =
    data.rows.length && data.options.payees.some((p) => p.id === query.payee_counterparty_id);
  const [payee] =
    visiblePayee && query.payee_counterparty_id
      ? await ctx.db
          .select({ name: counterparties.name, biz_no: counterparties.biz_no })
          .from(counterparties)
          .where(eq(counterparties.id, query.payee_counterparty_id))
      : [];
  const book = new ExcelJS.Workbook();
  book.creator = '차량 사용·정산';
  const usedNames = new Set<string>();
  for (const project of data.projects) {
    const base =
      project.name
        .replace(/[\\/*?:\[\]]/g, ' ')
        .trim()
        .replace(/^'+|'+$/g, '')
        .slice(0, 31) || '현장';
    let name = base;
    for (let n = 2; usedNames.has(name.toLowerCase()); n++)
      name = `${base.slice(0, 31 - String(n).length - 3)} (${n})`;
    usedNames.add(name.toLowerCase());
    const sheet = book.addWorksheet(name, {
      pageSetup: {
        orientation: 'landscape',
        paperSize: 9,
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 },
      },
    });
    const merged = (row: number, start: number, end: number, value: string | number) => {
      sheet.mergeCells(row, start, row, end);
      sheet.getCell(row, start).value = value === '' ? null : value;
    };
    merged(1, 1, 9, `거 래 명 세 표(${project.name})`);
    merged(2, 1, 9, `${data.from} ~ ${data.to}  (공급받는자 보관용)`);
    merged(3, 1, 4, '공급자');
    merged(3, 5, 9, '공급받는자');
    const identity = [
      [
        '등록번호',
        ctx.user.role === 'SITE_MANAGER' ? '' : (payee?.biz_no ?? ''),
        ctx.user.role === 'SITE_MANAGER' ? '' : (company?.biz_no ?? ''),
      ],
      ['상호', query.payee_counterparty_id ? (payee?.name ?? '') : '여러 지급처', company?.name ?? ''],
      ['성명', '', company?.representative ?? ''],
      ['사업장 주소', '', company?.address ?? ''],
      ['업태 / 종목', '', ''],
    ];
    identity.forEach(([label, supplier, buyer], index) => {
      const row = index + 4;
      merged(row, 1, 2, label);
      merged(row, 3, 4, supplier);
      sheet.getCell(row, 5).value = label;
      merged(row, 6, 9, buyer);
    });
    merged(
      9,
      1,
      9,
      `${data.include === 'all' ? '검수 전 금액은 별도 표시하며 합계에서 제외합니다.' : '승인된 금액만 표시합니다.'} 금액 단위: 원 · 추가 비용은 별도 줄 · 단가는 계약 세금 기준`,
    );
    sheet.addRow(['월', '일', '품목', '규격', '수량', '단가', '공급가액', '비고', '기사명']);
    const rows = data.rows.filter((row) => row.project_id === project.id);
    for (const row of rows) {
      sheet.addRow([
        Number(row.use_date.slice(5, 7)),
        Number(row.use_date.slice(8, 10)),
        row.route,
        row.load_tonnage ? `${new Decimal(row.load_tonnage).toString()}T` : '',
        row.quantity === null ? null : new Decimal(row.quantity).toNumber(),
        row.unit_price,
        row.supply,
        `${row.status === 'PENDING' ? '[검수 전] ' : ''}${row.cargo_desc}${row.supply === null ? ' (금액 미정)' : ''}`,
        row.driver_name,
      ]);
    }
    const totals: [string, number | string][] = [
      ['합계 금액', project.approved_supply],
      ['부가세', project.approved_tax],
      ['합계', sumMoney([project.approved_supply, project.approved_tax])],
      ...(data.include === 'all'
        ? ([
            ['검수 전 공급가 (합계 제외)', project.pending_supply],
            ['금액 미정 비용 수', project.pending_unknown_count],
          ] as [string, number][])
        : []),
      ['인수자', ''],
    ];
    for (const [label, value] of totals) {
      const row = sheet.rowCount + 1;
      merged(row, 1, 6, label);
      merged(row, 7, 9, value);
      sheet.getRow(row).font = { bold: true };
    }
    [5, 5, 30, 10, 10, 16, 18, 28, 14].forEach((width, index) => (sheet.getColumn(index + 1).width = width));
    sheet.eachRow((row) => {
      row.height = row.number === 1 ? 34 : row.number >= 11 && row.number < 11 + rows.length ? 42 : 28;
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { name: '맑은 고딕', size: 10, ...cell.font };
        cell.alignment = { vertical: 'middle', wrapText: true };
        cell.border = {
          top: { style: 'thin' },
          bottom: { style: 'thin' },
          left: { style: 'thin' },
          right: { style: 'thin' },
        };
        if (typeof cell.value === 'number')
          cell.numFmt = Number(cell.col) === 5 && !Number.isInteger(cell.value) ? '#,##0.###' : '#,##0';
      });
    });
    sheet.getCell('A1').font = { name: '맑은 고딕', size: 20, bold: true };
    sheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(10).eachCell((cell) => {
      cell.font = { name: '맑은 고딕', size: 10, bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    });
    sheet.pageSetup.printArea = `A1:I${sheet.rowCount}`;
    sheet.pageSetup.printTitlesRow = '1:10';
    sheet.views = [{ state: 'frozen', ySplit: 10 }];
  }
  if (!book.worksheets.length)
    book.addWorksheet('조회 결과').addRow(['선택한 기간과 필터에 해당하는 운행이 없습니다.']);
  return {
    bytes: new Uint8Array(await book.xlsx.writeBuffer()),
    filename: `거래명세표_${data.from}_${data.to}.xlsx`,
  };
}
