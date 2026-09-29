import { expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { eq } from 'drizzle-orm';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { callRoute } from '../helpers/routes';
import { importJobs, rateAgreements } from '../../src/server/db/schema';
import {
  commitImport,
  deleteStaleImportPreviews,
  getImport,
  importErrors,
  listImports,
  previewImport,
  uploadImport,
} from '../../src/server/services/import';
import { getUse } from '../../src/server/services/uses';
import { DELETE } from '../../src/app/api/import/route';

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
  '추가비',
  '사유',
  '운행횟수',
];
type Scenario = Awaited<ReturnType<typeof setupScenario>>;
function row(s: Scenario, overrides: Record<number, ExcelJS.CellValue> = {}) {
  return Object.assign<ExcelJS.CellValue[], Record<number, ExcelJS.CellValue>>(
    [
      '2026-09-15',
      s.project.code,
      s.driver.id,
      s.vehicle.plate_no,
      s.payee.id,
      '부산항',
      '현장',
      '일대',
      '1',
      '',
      '',
      '',
      '1',
    ],
    overrides,
  );
}
async function file(rows: ExcelJS.CellValue[][]) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('사용');
  sheet.addRow(headers);
  rows.forEach((values) => sheet.addRow(values));
  return Buffer.from(await book.xlsx.writeBuffer());
}
async function preview(s: Scenario, rows: ExcelJS.CellValue[][], applyContractRate = true) {
  const job = await uploadImport(s.adminCtx, 'W8b.xlsx', await file(rows));
  return previewImport(s.adminCtx, job.id, {
    sheet: 0,
    header_row: 1,
    mapping: job.sheets[0].mapping,
    apply_contract_rate: applyContractRate,
  });
}

it('8a. 빈 단가는 사용일·현장·차종·톤수에 가장 구체적인 계약과 세금·최소요금을 적용한다', async () => {
  const s = await setupScenario(database().db);
  const rate = await s.f.rate(s.payee.id, {
    project_id: s.project.id,
    vehicle_type: s.vehicle.vehicle_type,
    tonnage: s.vehicle.tonnage,
    valid_from: '2026-09-01',
    valid_to: '2026-09-30',
    unit_price: 123000,
    min_charge: 150000,
    tax_mode: 'TAX_EXEMPT',
    rounding: 'DOWN',
  });
  await s.f.rate(s.payee.id, { project_id: s.project.id, tonnage: '5', unit_price: 999000 });
  await s.f.rate(s.payee.id, { valid_from: '2026-10-01', unit_price: 888000 });
  const job = await preview(s, [row(s)]);
  expect(job.selection?.apply_contract_rate).toBe(true);
  expect(job.preview[0].warnings.join()).toContain('계약 단가 적용: 123,000원');
  const saved = await commitImport(s.adminCtx, job.id);
  const use = await getUse(s.adminCtx, saved.preview[0].use_id!);
  expect(use).toMatchObject({ entered_as: 'PROXY', review_status: 'DRAFT', approved_revision_id: null });
  expect(use.charge_lines[0]).toMatchObject({
    unit_price: 123000,
    computed_amount: 150000,
    price_status: 'CONFIRMED',
    rate_agreement_id: rate.id,
    tax_mode: 'TAX_EXEMPT',
    rounding: 'DOWN',
    approved_amount: null,
    tax_amount: null,
    line_review_status: 'PENDING',
    agreement_snapshot: {
      imported_unit_price: null,
      applied_contract_rate: true,
      unit_price: 123000,
      min_charge: 150000,
    },
  });
});

it('8a. 옵션 해제·계약 없음·청구수량 없음은 미확정, 파일 0원은 확정하며 기존 호출도 보존한다', async () => {
  const s = await setupScenario(database().db);
  const off = await preview(s, [row(s)], false);
  const savedOff = await commitImport(s.adminCtx, off.id);
  const offUse = await getUse(s.adminCtx, savedOff.preview[0].use_id!);
  expect(offUse.charge_lines[0]).toMatchObject({
    unit_price: null,
    computed_amount: null,
    price_status: 'PENDING',
  });
  const oldApi = await uploadImport(s.adminCtx, 'legacy.xlsx', await file([row(s)]));
  const legacy = await previewImport(s.adminCtx, oldApi.id, {
    sheet: 0,
    header_row: 1,
    mapping: oldApi.sheets[0].mapping,
  });
  expect(legacy.selection?.apply_contract_rate).toBe(false);
  expect(legacy.preview[0].status).toBe('SKIPPED');
  const missing = await s.f.counterparty();
  await s.f.rate(s.payee.id, { billing_unit: 'PER_TRIP', unit_price: 1000 });
  const pending = await preview(s, [
    row(s, { 4: missing.id }),
    row(s, { 9: '0' }),
    row(s, { 7: '회당', 8: '' }),
  ]);
  const saved = await commitImport(s.adminCtx, pending.id);
  const uses = await Promise.all(saved.preview.map((value) => getUse(s.adminCtx, value.use_id!)));
  expect(uses[0].charge_lines[0]).toMatchObject({ price_status: 'PENDING', unit_price: null });
  expect(uses[1].charge_lines[0]).toMatchObject({
    price_status: 'CONFIRMED',
    unit_price: 0,
    computed_amount: 0,
  });
  expect(uses[2].charge_lines[0]).toMatchObject({
    price_status: 'PENDING',
    quantity: null,
    computed_amount: null,
  });
});

it('8a. 저장 시 계약을 다시 검증하고 명시된 파일 단가는 계약보다 우선한다', async () => {
  const s = await setupScenario(database().db);
  const job = await preview(s, [row(s), row(s, { 9: '120000' })]);
  await database().db.update(rateAgreements).set({ active: false }).where(eq(rateAgreements.id, s.rate.id));
  const saved = await commitImport(s.adminCtx, job.id);
  const uses = await Promise.all(saved.preview.map((value) => getUse(s.adminCtx, value.use_id!)));
  expect(uses[0].charge_lines[0]).toMatchObject({
    price_status: 'PENDING',
    unit_price: null,
    rate_agreement_id: null,
  });
  expect(uses[1].charge_lines[0]).toMatchObject({
    price_status: 'CONFIRMED',
    unit_price: 120000,
    computed_amount: 120000,
  });
});

it('8b. 한 행의 날짜·기준정보·수량·금액·경로·추가비 사유·수식 오류를 모두 출력한다', async () => {
  const s = await setupScenario(database().db);
  const job = await preview(s, [
    row(s, {
      0: '2026-02-30',
      1: '없는 현장',
      2: '없는 기사',
      3: '없는 차량',
      4: '없는 지급처',
      5: '',
      6: '',
      7: '없는 단위',
      8: '1.12345',
      9: '-1',
      10: '1.2',
      11: '',
      12: '501',
    }),
    row(s, { 5: { formula: '1+1' }, 6: { error: '#VALUE!' }, 9: '잘못된 금액' }),
  ]);
  expect(job.summary?.errors).toBe(2);
  for (const field of [
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
    '추가비',
    '추가비 사유',
    '운행횟수',
  ]) {
    expect(job.preview[0].errors.some((message) => message.startsWith(`${field}:`))).toBe(true);
  }
  expect(job.preview[1].errors.join()).toContain('수식 결과가 없습니다');
  expect(job.preview[1].errors.join()).toContain('오류 셀');
  expect(job.preview[1].errors.join()).toContain('단가:');
  const errors = new ExcelJS.Workbook();
  await errors.xlsx.load((await importErrors(s.adminCtx, job.id)) as unknown as ExcelJS.Buffer);
  const exported = errors.worksheets[0].getRow(2).getCell(headers.length + 2).text;
  for (const message of job.preview[0].errors) expect(exported).toContain(message);
  expect((await commitImport(s.adminCtx, job.id)).summary?.success).toBe(0);
});

it('8c. 본인의 7일 미사용 PREVIEW만 삭제하며 최근·수정된·완료 작업과 다른 사용자 작업은 보존한다', async () => {
  const s = await setupScenario(database().db);
  const other = await setupScenario(database().db);
  const stale = await preview(s, [row(s)]);
  const recent = await preview(s, [row(s)]);
  const updated = await preview(s, [row(s)]);
  const completed = await preview(s, [row(s)]);
  await commitImport(s.adminCtx, completed.id);
  const foreign = await preview(other, [row(other)]);
  const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  for (const id of [stale.id, updated.id, completed.id, foreign.id]) {
    await database()
      .db.update(importJobs)
      .set({ created_at: oldDate, updated_at: oldDate })
      .where(eq(importJobs.id, id));
  }
  await previewImport(s.adminCtx, updated.id, updated.selection);
  const before = await listImports(s.adminCtx);
  expect(before.find((item) => item.id === stale.id)?.stale_preview).toBe(true);
  expect(before.find((item) => item.id === updated.id)?.stale_preview).toBe(false);
  expect(await deleteStaleImportPreviews(s.adminCtx)).toEqual({ deleted: 1 });
  await expect(getImport(s.adminCtx, stale.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  for (const id of [recent.id, updated.id, completed.id])
    expect((await getImport(s.adminCtx, id)).id).toBe(id);
  expect((await getImport(other.adminCtx, foreign.id)).id).toBe(foreign.id);
  expect(await deleteStaleImportPreviews(s.adminCtx)).toEqual({ deleted: 0 });
});

it('8c. 오래된 미리보기 삭제 API는 기사·미인증 요청을 거부한다', async () => {
  const s = await setupScenario(database().db);
  const { token } = await s.f.session(s.driverUser.id);
  const response = await callRoute(database().db, DELETE, {
    method: 'DELETE',
    path: '/api/import',
    token,
    headers: { 'idempotency-key': crypto.randomUUID() },
  });
  expect(response.status).toBe(403);
  expect((await callRoute(database().db, DELETE, { method: 'DELETE', path: '/api/import' })).status).toBe(
    401,
  );
});

it('8b. 날짜 오류가 있어도 다른 필드의 스키마 길이 오류를 끝까지 수집한다', async () => {
  const s = await setupScenario(database().db);
  const job = await uploadImport(
    s.adminCtx,
    '길이.csv',
    Buffer.from(
      '사용일,현장,기사,차량번호,지급처,출발지,도착지,과금단위,운반내용,비고\n2026-02-30,현장,기사,차량,지급처,출발,도착,일대,화물,비고',
    ),
  );
  const [stored] = await database().db.select().from(importJobs).where(eq(importJobs.id, job.id));
  const payload = stored.rows as { sheets: { rows: string[][] }[] };
  payload.sheets[0].rows[1] = [
    '2026-02-30',
    s.project.id,
    s.driver.id,
    s.vehicle.id,
    s.payee.id,
    '가'.repeat(501),
    '나'.repeat(501),
    '일대',
    '다'.repeat(5001),
    '라'.repeat(5001),
  ];
  // Also protect persisted preview data, even if its older upload path allowed longer cells.
  await database().db.update(importJobs).set({ rows: payload }).where(eq(importJobs.id, job.id));
  const result = await previewImport(s.adminCtx, job.id, {
    sheet: 0,
    header_row: 1,
    mapping: job.sheets[0].mapping,
  });
  expect(result.summary?.errors).toBe(1);
  for (const field of ['사용일', '출발지', '도착지', '운반내용', '비고']) {
    expect(result.preview[0].errors.some((message) => message.startsWith(`${field}:`))).toBe(true);
  }
});
