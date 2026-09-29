import { expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { performance } from 'node:perf_hooks';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { uploadImport, previewImport, commitImport } from '../../src/server/services/import';
import * as lookups from '../../src/server/services/lookups';
import { createUse } from '../../src/server/services/uses';
import { POST as uploadRoute } from '../../src/app/api/import/upload/route';
import { withDatabase } from '../../src/server/db/client';

const database = testDatabase();
const headers = [
  '사용일',
  '현장',
  '기사',
  '차량번호',
  '지급처',
  '출발지',
  '도착지',
  '과금단위',
  '청구수량',
  '단가',
  '비고',
];
type Scenario = Awaited<ReturnType<typeof setupScenario>>;
function row(s: Scenario) {
  return [
    '2026-09-15',
    s.project.code,
    s.driver.id,
    s.vehicle.plate_no,
    s.payee.id,
    '부산항',
    '현장',
    '일대',
    '2.500',
    '300000',
    '',
  ];
}
async function file(rows: ExcelJS.CellValue[][], configure?: (book: ExcelJS.Workbook) => void) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('사용');
  sheet.addRow(headers);
  rows.forEach((r) => sheet.addRow(r));
  configure?.(book);
  return Buffer.from(await book.xlsx.writeBuffer());
}
async function preview(s: Scenario, bytes: Buffer) {
  const job = await uploadImport(s.adminCtx, '사용.xlsx', bytes);
  return previewImport(s.adminCtx, job.id, { sheet: 0, header_row: 1, mapping: job.sheets[0].mapping });
}
it('2. 반복 공유 문자열 XLSX는 3초 내 한국어 크기 오류로 거부한다', async () => {
  const s = await setupScenario(database().db);
  const bytes = await file(Array.from({ length: 1800 }, () => ['가'.repeat(32767)]));
  const start = performance.now();
  await expect(uploadImport(s.adminCtx, '반복.xlsx', bytes)).rejects.toThrow('파일이 너무 큽니다');
  expect(performance.now() - start).toBeLessThan(3000);
}, 15000);
it.each(['rows', 'columns', 'json'] as const)('2. %s 한도를 파싱/저장 전에 거부한다', async (kind) => {
  const s = await setupScenario(database().db);
  const rows =
    kind === 'rows'
      ? Array.from({ length: 2001 }, () => ['값'])
      : kind === 'columns'
        ? [Array(101).fill('값')]
        : Array.from({ length: 1800 }, () => Array(10).fill('가'.repeat(500)));
  await expect(preview(s, await file(rows))).rejects.toThrow('파일이 너무 큽니다');
});
it('3. CP949 CSV를 UTF-8 안내 422로 거부한다', async () => {
  const s = await setupScenario(database().db);
  const { token } = await s.f.session(s.admin.id);
  const form = new FormData();
  form.set(
    'file',
    new Blob([new Uint8Array([0xbb, 0xe7, 0xbf, 0xeb, 0xc0, 0xcf, 0x2c, 0xc7, 0xf6, 0xc0, 0xe5])]),
    'cp949.csv',
  );
  const response = await withDatabase(database().db, () =>
    uploadRoute(
      new Request('http://localhost/api/import/upload', {
        method: 'POST',
        headers: { cookie: `sid=${token}` },
        body: form,
      }),
      { params: Promise.resolve({}) },
    ),
  );
  expect(response.status).toBe(422);
  expect((await response.json()).error.message).toBe(
    'CSV 인코딩을 UTF-8 로 저장해 주세요 (Excel: CSV UTF-8)',
  );
});
it('5. 미리보기/확정마다 날짜별 기준정보를 한 번 조회한다', async () => {
  const s = await setupScenario(database().db);
  const spy = vi.spyOn(lookups, 'getLookups');
  try {
    const job = await preview(s, await file([row(s), row(s), Object.assign(row(s), { 0: '2026-09-16' })]));
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockClear();
    await commitImport(s.adminCtx, job.id);
    expect(spy).toHaveBeenCalledTimes(2);
  } finally {
    spy.mockRestore();
  }
});
it('6. 다른 시트/미매핑 오류 셀은 무시하고 수식 결과만 사용, 결과 없는 행만 오류', async () => {
  const s = await setupScenario(database().db);
  const values: ExcelJS.CellValue[] = row(s);
  values[9] = { formula: '150000*2', result: 300000 };
  values.push({ error: '#DIV/0!' });
  const missing: ExcelJS.CellValue[] = row(s);
  missing[9] = { formula: '1+1' };
  const error: ExcelJS.CellValue[] = row(s);
  error[9] = { error: '#VALUE!' };
  const job = await preview(
    s,
    await file([values, missing, error], (book) => {
      book.addWorksheet('무시').getCell('A1').value = { error: '#VALUE!' };
    }),
  );
  expect(job.summary).toMatchObject({ valid: 1, errors: 2 });
  expect(job.preview[1].errors.join()).toContain('수식');
  expect((await commitImport(s.adminCtx, job.id)).summary?.success).toBe(1);
});
it('7. 재저장·날짜/수량/ID 표현 차이와 행 이동에도 내용 중복 0, 파일 내 반복행 보존 및 동시 확정', async () => {
  const s = await setupScenario(database().db);
  const a = await preview(s, await file([row(s), row(s)]));
  const changed = Object.assign(row(s), { 0: '2026/9/15', 1: s.project.id, 8: '2.5', 9: '300,000' });
  const b = await preview(
    s,
    await file([[], changed, changed], (book) => {
      book.creator = '다시 저장';
    }),
  );
  expect(a.preview.map((r) => r.source_row_hash)).toEqual(b.preview.map((r) => r.source_row_hash));
  const results = await Promise.all([commitImport(s.adminCtx, a.id), commitImport(s.adminCtx, b.id)]);
  expect(results.map((r) => r.summary!.success).sort()).toEqual([0, 2]);
  const again = await preview(s, await file([changed, changed]));
  expect(again.summary).toMatchObject({ valid: 0, skipped: 2 });
});
it('7. 중복 의심 행을 개별 제외하면 확정에서도 제외하며 다른 반복행 순번 유지', async () => {
  const s = await setupScenario(database().db);
  await createUse(s.adminCtx, { ...s.input, trips: [{ seq: 1, origin: '부산항', destination: '현장' }] });
  const job = await preview(s, await file([row(s), row(s)]));
  expect(job.preview[0].warnings.join()).toContain('중복 의심');
  const selected = await previewImport(s.adminCtx, job.id, { ...job.selection, excluded_rows: [2] });
  expect(selected.summary).toMatchObject({ valid: 1, skipped: 1 });
  const result = await commitImport(s.adminCtx, job.id);
  expect(result.summary?.success).toBe(1);
  expect(result.preview[0].use_id).toBeUndefined();
  expect(result.preview[1].source_row_hash).toBe(job.preview[1].source_row_hash);
});

it('6. 선택하지 않은 2,001행 시트는 헤더 표본만 읽고 선택 시트만 검증한다', async () => {
  const s = await setupScenario(database().db);
  const book = new ExcelJS.Workbook();
  const unused = book.addWorksheet('다른 자료');
  for (let i = 0; i < 2001; i++) unused.addRow(['설명']);
  const sheet = book.addWorksheet('사용');
  sheet.addRow(headers);
  sheet.addRow(row(s));
  const job = await uploadImport(s.adminCtx, '시트.xlsx', Buffer.from(await book.xlsx.writeBuffer()));
  expect(job.sheets[0].rows).toHaveLength(20);
  const selected = await previewImport(s.adminCtx, job.id, {
    sheet: 1,
    header_row: 1,
    mapping: job.sheets[1].mapping,
  });
  expect(selected.summary?.valid).toBe(1);
});
