import { expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { eq } from 'drizzle-orm';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { importJobs, projectAssignments, users, vehicleUses } from '../../src/server/db/schema';
import {
  commitImport,
  getImport,
  importErrors,
  listImports,
  listImportPresets,
  previewImport,
  saveImportPreset,
  suggestMapping,
  uploadImport,
} from '../../src/server/services/import';
import { getUse, createUse } from '../../src/server/services/uses';
import { callRoute } from '../helpers/routes';
import { GET as download } from '../../src/app/api/import/[id]/errors.xlsx/route';
import { POST as commitRoute } from '../../src/app/api/import/[id]/commit/route';
const database = testDatabase();
const headers = [
  '사용일',
  '현장',
  '기사',
  '차량번호',
  '운송사',
  '출발지',
  '도착지',
  '운반내용',
  '운행횟수',
  '과금단위',
  '청구수량',
  '단가',
  '추가비',
  '사유',
  '비고',
];
type Scenario = Awaited<ReturnType<typeof setupScenario>>;
function row(s: Scenario, overrides: Record<number, string> = {}) {
  return Object.assign(
    [
      '2026-09-15',
      s.project.code,
      s.driver.id,
      s.vehicle.plate_no,
      s.payee.id,
      '부산항',
      '현장',
      '자재',
      '5',
      '일대',
      '',
      '300000',
      '',
      '',
      '',
    ],
    overrides,
  );
}
async function file(rows: string[][]) {
  const book = new ExcelJS.Workbook();
  book.addWorksheet('안내').addRow(['사용내역 가져오기']);
  const sheet = book.addWorksheet('사용 내역');
  sheet.addRow(['월간 차량 사용내역']);
  sheet.addRow(headers);
  rows.forEach((r) => sheet.addRow(r));
  return Buffer.from(await book.xlsx.writeBuffer());
}
async function preview(s: Scenario, bytes: Buffer) {
  const job = await uploadImport(s.adminCtx, '운행.xlsx', bytes);
  expect(job.sheets[1].header_row).toBe(2);
  return previewImport(s.adminCtx, job.id, { sheet: 1, header_row: 2, mapping: job.sheets[1].mapping });
}
it('유효·오류·중복 행 분류, 운행5/일대1, PROXY DRAFT, 오류 엑셀 및 재가져오기 중복 0', async () => {
  const s = await setupScenario(database().db);
  const bytes = await file([
    row(s),
    row(s, { 0: '2026-02-30' }),
    row(s, { 11: '1.5' }),
    row(s, { 1: '없는 현장' }),
    row(s, { 12: '1000', 13: '' }),
  ]);
  const job = await preview(s, bytes);
  expect(job.summary).toMatchObject({ valid: 1, errors: 4, skipped: 0 });
  const result = await commitImport(s.adminCtx, job.id);
  expect(result.summary?.success).toBe(1);
  const use = await getUse(s.adminCtx, result.preview[0].use_id!);
  expect(use).toMatchObject({
    entered_as: 'PROXY',
    review_status: 'DRAFT',
    import_job_id: job.id,
    approved_revision_id: null,
  });
  expect(use.trips).toHaveLength(5);
  expect(use.charge_lines[0]).toMatchObject({
    quantity: '1.000',
    unit_price: 300000,
    computed_amount: 300000,
    approved_amount: null,
    line_review_status: 'PENDING',
  });
  const errors = new ExcelJS.Workbook();
  await errors.xlsx.load((await importErrors(s.adminCtx, job.id)) as unknown as ExcelJS.Buffer);
  expect(errors.worksheets[0].rowCount).toBe(5);
  expect(errors.worksheets[0].getRow(2).getCell(headers.length + 2).text).toContain('사용일');
  const second = await preview(s, bytes);
  expect(second.summary).toMatchObject({ valid: 0, skipped: 1, errors: 4 });
  expect((await commitImport(s.adminCtx, second.id)).summary?.success).toBe(0);
  expect((await commitImport(s.adminCtx, job.id)).summary?.success).toBe(1);
  expect(
    await database().db.select().from(vehicleUses).where(eq(vehicleUses.import_job_id, job.id)),
  ).toHaveLength(1);
  expect(await listImports(s.adminCtx)).toHaveLength(2);
});
it('회당 운행횟수는 청구수량이 아니며 파일 단가 누락은 PENDING, 0원은 CONFIRMED, 계약 차이는 경고', async () => {
  const s = await setupScenario(database().db);
  await s.f.rate(s.payee.id, { billing_unit: 'PER_TRIP', unit_price: 100000 });
  const job = await preview(
    s,
    await file([
      row(s, { 9: '회당', 10: '5', 11: '100000' }),
      row(s, { 9: '회당', 10: '', 11: '100000' }),
      row(s, { 11: '' }),
      row(s, { 11: '0' }),
      row(s, { 11: '310000' }),
    ]),
  );
  expect(job.summary?.valid).toBe(5);
  expect(job.preview[4].warnings.join()).toContain('계약 단가');
  const result = await commitImport(s.adminCtx, job.id);
  const uses = await Promise.all(result.preview.map((r) => getUse(s.adminCtx, r.use_id!)));
  expect(uses[0].charge_lines[0].computed_amount).toBe(500000);
  expect(uses[1].charge_lines[0]).toMatchObject({
    quantity: null,
    price_status: 'PENDING',
    computed_amount: null,
  });
  expect(uses[2].charge_lines[0]).toMatchObject({ unit_price: null, price_status: 'PENDING' });
  expect(uses[3].charge_lines[0]).toMatchObject({
    unit_price: 0,
    price_status: 'CONFIRMED',
    computed_amount: 0,
  });
  expect(uses[4].charge_lines[0].computed_amount).toBe(310000);
});
it('동일 파일 동시 확정은 한 건만 생성하고 실제 반복행은 보존, 비슷한 기존 사용은 경고만', async () => {
  const s = await setupScenario(database().db);
  await createUse(s.adminCtx, { ...s.input, trips: [{ seq: 1, origin: '부산항', destination: '현장' }] });
  const bytes = await file([row(s), row(s)]);
  const a = await preview(s, bytes);
  const b = await preview(s, bytes);
  expect(a.preview.every((r) => r.warnings.some((w) => w.includes('중복 의심')))).toBe(true);
  const result = await Promise.all([commitImport(s.adminCtx, a.id), commitImport(s.adminCtx, b.id)]);
  expect(result.map((r) => r.summary!.success).sort()).toEqual([0, 2]);
  expect(result.reduce((n, r) => n + r.summary!.skipped, 0)).toBe(2);
});
it('CSV 문자열·별칭 자동 매핑·프리셋 저장/수정은 작성자별이며 다른 사용자·기사 접근 차단', async () => {
  const s = await setupScenario(database().db);
  const csv = Buffer.from(
    '\uFEFF' + [headers.join(','), row(s, { 0: '2026/9/15', 11: '300000' }).join(',')].join('\n'),
  );
  const uploaded = await uploadImport(s.adminCtx, '내역.csv', csv);
  const checked = await previewImport(s.adminCtx, uploaded.id, {
    sheet: 0,
    header_row: 1,
    mapping: uploaded.sheets[0].mapping,
  });
  expect(checked.summary?.valid).toBe(1);
  expect(suggestMapping(['운행일자', '차번', '청구 수량'])).toEqual({ use_date: 0, vehicle: 1, quantity: 2 });
  await saveImportPreset(s.adminCtx, { name: '월간', mapping: checked.selection!.mapping });
  await saveImportPreset(s.adminCtx, { name: '월간', mapping: { use_date: 2 } });
  expect(await listImportPresets(s.adminCtx)).toHaveLength(1);
  const other = await s.f.user();
  expect(await listImportPresets(s.f.context(other))).toHaveLength(0);
  await expect(getImport(s.f.context(other), uploaded.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(uploadImport(s.driverCtx, '내역.csv', csv)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const session = await s.f.session(s.driverUser.id);
  expect(
    (await callRoute(database().db, download, { token: session.token, params: { id: uploaded.id } })).status,
  ).toBe(403);
});
it('미리보기 이후 현장 권한 회수·비활성화는 확정/재요청 차단하며 클라이언트 검증 결과를 신뢰하지 않음', async () => {
  const s = await setupScenario(database().db);
  const manager = await s.f.user({ role: 'SITE_MANAGER' });
  const assignment = await s.f.assignment(manager.id, s.project.id);
  const ctx = s.f.context(manager);
  const uploaded = await uploadImport(ctx, '입력.xlsx', await file([row(s)]));
  await previewImport(ctx, uploaded.id, { sheet: 1, header_row: 2, mapping: uploaded.sheets[1].mapping });
  await database()
    .db.update(projectAssignments)
    .set({ revoked_at: new Date() })
    .where(eq(projectAssignments.id, assignment.id));
  const result = await commitImport(ctx, uploaded.id);
  expect(result.summary).toMatchObject({ success: 0, errors: 1 });
  const session = await s.f.session(manager.id);
  await database().db.update(users).set({ status: 'DISABLED' }).where(eq(users.id, manager.id));
  const response = await callRoute(database().db, commitRoute, {
    method: 'POST',
    body: {},
    token: session.token,
    params: { id: uploaded.id },
    headers: { 'idempotency-key': 'retry' },
  });
  expect(response.status).toBe(401);
  expect(
    (await database().db.select().from(importJobs).where(eq(importJobs.id, uploaded.id)))[0].status,
  ).toBe('COMMITTED');
});
it('잘못된 파일·수식·중복 매핑·금액 범위는 거부하고 확정 직전 기준정보를 다시 검증한다', async () => {
  const s = await setupScenario(database().db);
  await expect(uploadImport(s.adminCtx, 'bad.xlsx', Buffer.from('broken'))).rejects.toMatchObject({
    code: 'VALIDATION_FAILED',
  });
  const book = new ExcelJS.Workbook();
  book.addWorksheet('수식').getCell('A1').value = { formula: '1+1', result: 2 };
  await expect(
    uploadImport(s.adminCtx, 'formula.xlsx', Buffer.from(await book.xlsx.writeBuffer())),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  const job = await preview(s, await file([row(s, { 10: '999999999', 11: '2147483647' })]));
  expect(job.summary?.errors).toBe(1);
  await expect(
    previewImport(s.adminCtx, job.id, { sheet: 1, header_row: 2, mapping: { driver: 1, project: 1 } }),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
});

it('외부 client_request_id가 가져오기 해시를 선점해도 기존 사용 건을 덮어쓰지 않는다', async () => {
  const s = await setupScenario(database().db);
  const job = await preview(s, await file([row(s)]));
  const previous = await createUse(s.adminCtx, {
    ...s.input,
    client_request_id: `import:${job.preview[0].source_row_hash}`,
    notes: '기존 사용 건 보존',
  });
  const imported = await commitImport(s.adminCtx, job.id);
  expect(imported.summary?.success).toBe(1);
  expect(imported.preview[0].use_id).not.toBe(previous.id);
  const original = await getUse(s.adminCtx, previous.id);
  expect(original.import_job_id).toBeNull();
  expect(original.source_row_hash).toBeNull();
  expect(original.notes).toBe('기존 사용 건 보존');
});
