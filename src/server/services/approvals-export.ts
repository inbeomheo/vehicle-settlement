import ExcelJS from 'exceljs';
import type { Context } from '../context';
import { managerOnly } from './admin';
import { getApprovals } from './approvals';
import type { LedgerRow } from './ledger';
import { approvalLabels } from '../../shared/approvals';
export async function exportApprovals(ctx: Context, raw: unknown) {
  await managerOnly(ctx);
  const data = await getApprovals(ctx, raw, true);
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('운행 결재');
  sheet.addRow([
    '사용번호',
    '운송일자',
    '운송내역',
    '운반 내용',
    '프로젝트',
    '기사명',
    '담당자',
    '입력·검토 금액(공급가)',
    '승인 금액(공급가)',
    '진행상태',
  ]);
  for (const row of data.rows as LedgerRow[])
    sheet.addRow([
      row.use_no,
      row.use_date,
      row.route_summary,
      row.cargo_desc,
      row.project_name,
      row.driver_name,
      row.reviewer_name ?? '미지정',
      row.review_total_amount,
      row.total_amount,
      row.operation_status === 'CANCELED' ? '취소' : approvalLabels[row.review_status],
    ]);
  sheet.addRow([
    `합계 ${data.summary.count}건 · 취소 제외 · 미확정 비용 ${data.summary.unknown_count}개`,
    '',
    '',
    '',
    '',
    '',
    '',
    data.summary.amount,
  ]);
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((column, index) => {
    column.width = index === 2 ? 40 : 24;
  });
  sheet.getColumn(8).numFmt = '#,##0';
  sheet.getColumn(9).numFmt = '#,##0';
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = 'A1:J1';
  return new Uint8Array(await book.xlsx.writeBuffer());
}
