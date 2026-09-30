import ExcelJS from 'exceljs';
import type { Context } from '../context';
import { sumMoney } from '../domain/money';
import { getSummary, type SummaryAmounts } from './summary';

export async function exportSummary(ctx: Context, query: unknown) {
  const data = await getSummary(ctx, query);
  const book = new ExcelJS.Workbook();
  book.creator = '차량 사용·정산';
  const all = data.include === 'all';
  const projects = new Map(data.projects.map((project) => [project.id, project]));
  const drivers = new Map(data.drivers.map((driver) => [driver.id, driver]));
  const values = (amounts: SummaryAmounts) => [
    amounts.count,
    amounts.approved_supply,
    amounts.approved_tax,
    sumMoney([amounts.approved_supply, amounts.approved_tax]),
    ...(all ? [amounts.pending_supply, amounts.pending_unknown_count] : []),
  ];
  const createSheet = (name: string, headers: string[]) => {
    const sheet = book.addWorksheet(name);
    sheet.addRow([`현장·기사별 집계 · ${data.from} ~ ${data.to}`]);
    sheet.mergeCells(1, 1, 1, headers.length);
    sheet.addRow([
      `${all ? '검수 전 포함 (승인 금액과 별도)' : '승인된 금액만'} · 금액 단위: 원 · 운행 건수: 사용대장 줄 수`,
    ]);
    sheet.mergeCells(2, 1, 2, headers.length);
    sheet.addRow(headers);
    sheet.getRow(1).height = 30;
    sheet.getRow(2).height = 35;
    sheet.getRow(2).alignment = { wrapText: true, vertical: 'middle' };
    sheet.getRow(3).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16364A' } };
    sheet.columns.forEach((column) => {
      column.width = 24;
    });
    sheet.views = [{ state: 'frozen', ySplit: 3, xSplit: 1 }];
    return sheet;
  };
  const amountHeaders = [
    '운행 건수',
    '승인 공급가',
    '승인 세액',
    '세액 포함 합계',
    ...(all ? ['검수 전 공급가', '금액 미정 비용 수'] : []),
  ];
  for (const byProject of [true, false]) {
    const sheet = createSheet(byProject ? '현장별' : '기사별', [
      ...(byProject ? ['현장', '기사', '소속 운송사/상호'] : ['기사', '소속 운송사/상호', '현장']),
      ...amountHeaders,
    ]);
    const groups = byProject ? data.projects : data.drivers;
    for (const group of groups) {
      const cells = data.cells
        .filter((cell) => (byProject ? cell.project_id : cell.driver_id) === group.id)
        .sort((a, b) => b.approved_supply - a.approved_supply);
      for (const cell of cells) {
        const project = projects.get(cell.project_id)!;
        const driver = drivers.get(cell.driver_id)!;
        const names = byProject
          ? [project.name, driver.name, driver.affiliations.join(', ')]
          : [driver.name, driver.affiliations.join(', '), project.name];
        sheet.addRow([...names, ...values(cell)]);
      }
      sheet.addRow([`${group.name} 합계`, '', '', ...values(group)]).font = { bold: true };
    }
    sheet.addRow(['전체 합계', '', '', ...values(data.totals)]).font = { bold: true };
    for (let column = 4; column <= sheet.columnCount; column++) sheet.getColumn(column).numFmt = '#,##0';
  }
  const table = createSheet('표', ['기사 / 현장', ...data.projects.map((p) => p.name), '기사 합계']);
  const cells = new Map(data.cells.map((cell) => [`${cell.project_id}:${cell.driver_id}`, cell]));
  for (const driver of data.drivers) {
    table.addRow([
      `${driver.name}${driver.affiliations.length ? ` (${driver.affiliations.join(', ')})` : ''}`,
      ...data.projects.map((project) => cells.get(`${project.id}:${driver.id}`)?.approved_supply || null),
      driver.approved_supply,
    ]);
    if (all) {
      const pending = table.addRow([
        `${driver.name} 검수 전`,
        ...data.projects.map((project) => cells.get(`${project.id}:${driver.id}`)?.pending_supply || null),
        driver.pending_supply,
      ]);
      pending.font = { color: { argb: 'FF64748B' } };
    }
  }
  table.addRow([
    '현장 합계',
    ...data.projects.map((p) => p.approved_supply),
    data.totals.approved_supply,
  ]).font = { bold: true };
  if (all)
    table.addRow(['검수 전 합계', ...data.projects.map((p) => p.pending_supply), data.totals.pending_supply]);
  table.getColumn(1).width = 42;
  for (let column = 2; column <= table.columnCount; column++) table.getColumn(column).numFmt = '#,##0';
  for (const sheet of book.worksheets) {
    sheet.eachRow((row, index) => {
      if (index > 2)
        row.eachCell((cell) => {
          cell.alignment = {
            vertical: 'middle',
            wrapText: true,
            horizontal: typeof cell.value === 'number' ? 'right' : 'left',
          };
        });
    });
  }
  return {
    bytes: new Uint8Array(await book.xlsx.writeBuffer()),
    filename: `현장기사별집계_${data.from}_${data.to}.xlsx`,
  };
}
