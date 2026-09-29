import ExcelJS from 'exceljs';
import type { Context } from '../context';
import { getLedger } from './ledger';
import { sumMoney } from '../domain/money';
const names: Record<string, string> = {
  PER_TRIP: '회당',
  PER_DAY: '일대',
  HALF_DAY: '반일',
  MONTHLY: '월대',
  PER_HOUR: '시간',
  PER_TON: '톤',
  PER_M3: '루베',
  LUMP_SUM: '1식',
  DRAFT: '작성 중',
  SUBMITTED: '제출됨',
  NEEDS_FIX: '보완 요청',
  APPROVED: '승인',
  UNSETTLED: '미정산',
  PARTIAL: '일부',
  SETTLED: '정산 완료',
  NOT_SETTLED: '미정산',
  UNPAID: '미지급',
  PAID: '지급 완료',
};
export async function exportLedger(ctx: Context, query: unknown) {
  const data = await getLedger(ctx, query, true);
  const book = new ExcelJS.Workbook();
  book.creator = '차량 사용·정산';
  const sheet = book.addWorksheet('차량 사용대장');
  const headers = [
    '사용번호',
    '사용일',
    '현장',
    '공종',
    '요청자',
    '기사',
    '차량',
    '차종',
    '톤수',
    '운송사/지급처',
    '출발',
    '도착',
    '작업내용',
    '계약단위',
    '실적',
    '기본비(승인 공급가)',
    '추가비(승인 공급가)',
    '합계(승인 공급가)',
    '고객청구 승인액',
    '증빙 수',
    '증빙 상태',
    '검수상태',
    '정산회차',
    '정산상태',
    '지급상태',
    '작성자',
    '입력구분',
  ];
  sheet.addRow(headers);
  for (const row of data.rows)
    sheet.addRow([
      row.use_no,
      row.use_date,
      row.project_name,
      row.work_type_name,
      row.requester,
      row.driver_name,
      row.plate_no,
      row.vehicle_type,
      row.tonnage,
      row.payee_name,
      row.origin,
      row.destination,
      row.cargo_desc,
      (row.billing_units ?? []).map((unit) => names[unit] ?? unit).join(', '),
      row.performance,
      row.base_amount,
      row.extra_amount,
      row.total_amount,
      row.receivable_amount,
      row.evidence_count,
      row.evidence_missing ? '필수 증빙 누락' : '충족',
      names[row.review_status],
      row.statement_numbers,
      names[row.settlement_status],
      names[row.payment_status],
      row.creator_name,
      row.entered_as === 'PROXY' ? '대리 입력' : '기사 직접',
    ]);
  const total = sheet.addRow([`전체 검색 결과 합계(${data.total}건)`]);
  total.getCell(16).value = sumMoney(data.rows.map((row) => row.base_amount));
  total.getCell(17).value = sumMoney(data.rows.map((row) => row.extra_amount));
  total.getCell(18).value = data.totals.filteredSum;
  total.getCell(19).value = sumMoney(data.rows.map((row) => row.receivable_amount));
  total.font = { bold: true };
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16364A' } };
  sheet.columns.forEach((column, index) => {
    column.width = index === 12 ? 32 : 20;
  });
  for (const index of [16, 17, 18, 19]) sheet.getColumn(index).numFmt = '#,##0"원"';
  sheet.views = [{ state: 'frozen', ySplit: 1, xSplit: 2 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, data.total + 1), column: headers.length },
  };
  return new Uint8Array(await book.xlsx.writeBuffer());
}
