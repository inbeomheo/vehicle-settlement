import ExcelJS from 'exceljs';
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import {
  uploadImport,
  previewImport,
  commitImport,
  getImport,
  importErrors,
} from '../../src/server/services/import';
import { importJobs } from '../../src/server/db/schema';
const database = testDatabase();
it('1,100행 XLSX 응답은 원본 중복 없이 4MiB 미만이며 전체 오류를 확인할 수 있다', async () => {
  const s = await setupScenario(database().db);
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('자료');
  sheet.addRow(['사용일', '현장', '기사', '차량번호', '지급처', '출발지', '도착지', '과금단위', '비고']);
  for (let i = 0; i < 1100; i++)
    sheet.addRow([
      '잘못된날짜',
      s.project.id,
      s.driver.id,
      s.vehicle.id,
      s.payee.id,
      '부산',
      '서울',
      '일대',
      '가'.repeat(500),
    ]);
  const uploaded = await uploadImport(s.adminCtx, '대량.xlsx', Buffer.from(await book.xlsx.writeBuffer()));
  const preview = await previewImport(s.adminCtx, uploaded.id, {
    sheet: 0,
    header_row: 1,
    mapping: uploaded.sheets[0].mapping,
  });
  expect(Buffer.byteLength(JSON.stringify({ data: preview }))).toBeLessThan(4 * 1024 * 1024);
  expect(preview.sheets[0].rows.length).toBeLessThanOrEqual(20);
  expect(preview.preview.filter((r) => r.status === 'ERROR')).toHaveLength(1100);
  const errors = new ExcelJS.Workbook();
  await errors.xlsx.load((await importErrors(s.adminCtx, uploaded.id)) as never);
  expect(errors.worksheets[0].rowCount).toBe(1101);
});
it('경고 없는 일반 미리보기는 앞 100행만 응답하고 확정은 저장 원본 전체를 사용한다', async () => {
  const s = await setupScenario(database().db);
  const header = '사용일,현장,기사,차량번호,지급처,출발지,도착지,과금단위,단가';
  const row = `2026-09-15,${s.project.id},${s.driver.id},${s.vehicle.id},${s.payee.id},부산,서울,일대,300000`;
  const uploaded = await uploadImport(
    s.adminCtx,
    '101행.csv',
    Buffer.from([header, ...Array(101).fill(row)].join('\n')),
  );
  const preview = await previewImport(s.adminCtx, uploaded.id, {
    sheet: 0,
    header_row: 1,
    mapping: uploaded.sheets[0].mapping,
  });
  expect(preview.preview).toHaveLength(100);
  preview.preview[0].values[0] = '변조';
  const committed = await commitImport(s.adminCtx, uploaded.id);
  expect(committed.summary?.success).toBe(101);
  expect((await getImport(s.adminCtx, uploaded.id)).summary?.success).toBe(101);
});
it('오류 전체를 포함한 응답이 4MiB를 넘으면 나눠 올리기 안내로 거부한다', async () => {
  const s = await setupScenario(database().db);
  const uploaded = await uploadImport(s.adminCtx, '작은.csv', Buffer.from('사용일\n오류'));
  await database()
    .db.update(importJobs)
    .set({
      rows: {
        sheets: [{ name: '자료', rows: [['사용일']], header_row: 1, mapping: {} }],
        preview: Array.from({ length: 1100 }, (_, i) => ({
          row: i + 2,
          status: 'ERROR',
          values: ['가'.repeat(1500)],
          errors: ['날짜 오류'],
          warnings: [],
          source_row_hash: '',
        })),
      },
    })
    .where(eq(importJobs.id, uploaded.id));
  await expect(getImport(s.adminCtx, uploaded.id)).rejects.toThrow('행이 너무 많습니다. 나눠서 올려 주세요');
});
