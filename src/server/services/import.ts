import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { importJobs, importPresets, vehicleUses, chargeLines, billingUnitEnum, trips } from '../db/schema';
import type { Context } from '../context';
import { accessibleUseFilter, assertActive, assertProjectAccess } from '../authz';
import { AppError, invalid, notFound } from '../errors';
import { audit } from '../audit';
import { computeAmount } from '../domain/money';
import { createUse, atomic } from './uses';
import { getLookups } from './lookups';
import { findRate } from './rates';
import { createUseSchema, type CreateUseInput } from './schemas';
import {
  importFields,
  previewSchema,
  presetSchema,
  type ImportMapping,
  type SheetData,
  type ImportRow,
  type ImportSummary,
} from './import-fields';

const normalize = (value: string) => value.toLowerCase().replace(/[\s_()·/.-]/g, '');
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
type Payload = { file_hash: string; sheets: SheetData[]; preview: ImportRow[] };
type Job = typeof importJobs.$inferSelect;
const units: Record<string, (typeof billingUnitEnum.enumValues)[number]> = {
  회당: 'PER_TRIP',
  건당: 'PER_TRIP',
  일대: 'PER_DAY',
  반일: 'HALF_DAY',
  월대: 'MONTHLY',
  시간: 'PER_HOUR',
  톤: 'PER_TON',
  루베: 'PER_M3',
  '1식': 'LUMP_SUM',
  식: 'LUMP_SUM',
};

async function manager(ctx: Context) {
  await assertActive(ctx);
  if (ctx.user.role === 'DRIVER') throw new AppError('FORBIDDEN', '담당자만 가져올 수 있습니다.');
}
async function jobFor(ctx: Context, id: string, lock = false) {
  await manager(ctx);
  const query = ctx.db
    .select()
    .from(importJobs)
    .where(and(eq(importJobs.id, z.string().uuid().parse(id)), eq(importJobs.created_by, ctx.user.id)));
  const [job] = await (lock ? query.for('update') : query);
  if (!job) notFound();
  return job;
}
function view(job: Job, name?: string) {
  const payload = job.rows as Payload;
  return {
    id: job.id,
    file_name: job.file_name,
    status: job.status,
    created_at: job.created_at.toISOString(),
    created_by_name: name,
    sheets: payload.sheets,
    selection: job.mapping as z.infer<typeof previewSchema> | null,
    preview: payload.preview,
    summary: job.summary as ImportSummary | null,
  };
}
export function suggestMapping(headers: string[]): ImportMapping {
  const result: ImportMapping = {};
  const used = new Set<number>();
  for (const [field, aliases] of Object.entries(importFields)) {
    const candidates = headers
      .map((header, index) => {
        const text = normalize(header);
        const score = Math.max(
          ...aliases.map((alias) => {
            const a = normalize(alias);
            return text === a
              ? 1
              : text && (text.includes(a) || a.includes(text))
                ? Math.min(text.length, a.length) / Math.max(text.length, a.length)
                : 0;
          }),
        );
        return { index, score };
      })
      .filter((c) => c.score >= 0.5 && !used.has(c.index))
      .sort((a, b) => b.score - a.score);
    if (candidates[0]) {
      result[field as keyof ImportMapping] = candidates[0].index;
      used.add(candidates[0].index);
    }
  }
  return result;
}
function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('formula' in value || 'sharedFormula' in value) invalid('수식 셀은 값으로 붙여넣은 후 업로드하세요.');
    if ('richText' in value) return value.richText.map((v) => v.text).join('');
    if ('text' in value) return value.text;
    invalid('해석할 수 없는 셀 값입니다.');
  }
  return String(value).trim();
}
export async function uploadImport(ctx: Context, fileName: string, bytes: Buffer) {
  await manager(ctx);
  if (!/\.(xlsx|csv)$/i.test(fileName) || fileName.length > 255)
    invalid('xlsx 또는 UTF-8 csv 파일을 선택하세요.');
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) invalid('파일은 10MB 이하로 업로드하세요.');
  const workbook = new ExcelJS.Workbook();
  try {
    if (/\.csv$/i.test(fileName))
      await workbook.csv.read(Readable.from([bytes]), {
        map: (v: string) => v,
        parserOptions: { ignoreEmpty: false },
      });
    else await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  } catch {
    invalid('파일을 읽을 수 없습니다. 손상 여부와 CSV 인코딩을 확인하세요.');
  }
  if (!workbook.worksheets.length || workbook.worksheets.length > 20) invalid('시트는 1~20개여야 합니다.');
  let totalRows = 0;
  const sheets: SheetData[] = workbook.worksheets.map((sheet) => {
    totalRows += sheet.rowCount;
    if (totalRows > 2000 || sheet.columnCount > 100) invalid('한 파일은 2,000행·100열 이하로 나누어 주세요.');
    const rows: string[][] = [];
    for (let i = 1; i <= sheet.rowCount; i++) {
      const row = sheet.getRow(i);
      rows.push(Array.from({ length: sheet.columnCount }, (_, c) => cellText(row.getCell(c + 1).value)));
    }
    let header = 0;
    for (let i = 1; i < Math.min(rows.length, 20); i++)
      if (
        Object.keys(suggestMapping(rows[i])).length > Object.keys(suggestMapping(rows[header] ?? [])).length
      )
        header = i;
    return { name: sheet.name, rows, header_row: header + 1, mapping: suggestMapping(rows[header] ?? []) };
  });
  return atomic(ctx, async (tx) => {
    const [job] = await tx.db
      .insert(importJobs)
      .values({
        file_name: fileName,
        created_by: tx.user.id,
        rows: { file_hash: sha(bytes), sheets, preview: [] },
      })
      .returning();
    await audit(tx, 'IMPORT_UPLOAD', 'import_job', job.id, null, { file_name: fileName });
    return view(job, tx.user.name);
  });
}
function money(value: string, label: string): number | null {
  if (!value) return null;
  if (!/^(\d+|\d{1,3}(,\d{3})+)(원)?$/.test(value)) invalid(`${label}: 0 이상의 정수 원을 입력하세요.`);
  const result = Number(value.replace(/[,원]/g, ''));
  if (!Number.isSafeInteger(result) || result > 2147483647) invalid(`${label}: 금액 범위를 초과했습니다.`);
  return result;
}
function date(value: string) {
  const match = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  const result = match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : value;
  if (!z.iso.date().safeParse(result).success) invalid('사용일: YYYY-MM-DD 날짜를 입력하세요.');
  return result;
}
function matchOne<T extends { id: string }>(rows: T[], value: string, keys: (keyof T)[], label: string): T {
  if (!value) invalid(`${label}: 필수 항목입니다.`);
  const matches = rows.filter((r) => keys.some((key) => normalize(String(r[key])) === normalize(value)));
  if (matches.length !== 1)
    invalid(`${label}: 기준정보 매칭 실패${matches.length > 1 ? ' (동명이인·중복 이름은 ID로 지정)' : ''}`);
  return matches[0];
}
async function resolveRow(ctx: Context, values: string[], mapping: ImportMapping) {
  const get = (field: keyof ImportMapping) =>
    mapping[field] === undefined ? '' : (values[mapping[field]!] ?? '').trim();
  const useDate = date(get('use_date'));
  const lookups = await getLookups(ctx, useDate);
  const project = matchOne(lookups.projects, get('project'), ['id', 'name', 'code'], '현장');
  const driver = matchOne(lookups.drivers, get('driver'), ['id', 'name'], '기사');
  const vehicle = matchOne(lookups.vehicles, get('vehicle'), ['id', 'plate_no'], '차량번호');
  const payee = matchOne(
    lookups.counterparties.filter((p) => p.kind !== 'CUSTOMER'),
    get('payee'),
    ['id', 'name'],
    '지급처',
  );
  const rawUnit = get('billing_unit');
  const unit = units[rawUnit] ?? rawUnit;
  if (!billingUnitEnum.enumValues.includes(unit as (typeof billingUnitEnum.enumValues)[number]))
    invalid('과금단위: 일대·회당·반일·월대·시간·톤·루베·1식을 지정하세요.');
  const billingUnit = unit as (typeof billingUnitEnum.enumValues)[number];
  const tripCount = Number(get('trips') || '1');
  if (!Number.isInteger(tripCount) || tripCount < 1 || tripCount > 500)
    invalid('운행횟수: 1~500 정수를 입력하세요.');
  const quantity =
    get('quantity') || (['PER_DAY', 'HALF_DAY', 'MONTHLY', 'LUMP_SUM'].includes(unit) ? '1' : null);
  const price = money(get('unit_price'), '단가');
  const extra = money(get('extra'), '추가비');
  const parsed = createUseSchema.safeParse({
    use_date: useDate,
    project_id: project.id,
    driver_id: driver.id,
    vehicle_id: vehicle.id,
    payee_counterparty_id: payee.id,
    cargo_desc: get('cargo_desc'),
    notes: get('notes'),
    billing_unit: billingUnit,
    quantity,
    trips: Array.from({ length: tripCount }, (_, i) => ({
      seq: i + 1,
      origin: get('origin'),
      destination: get('destination'),
      cargo_desc: get('cargo_desc'),
    })),
    charge_lines: [
      { charge_type: 'BASE', billing_unit: billingUnit, quantity },
      ...(extra !== null ? [{ charge_type: 'OTHER', requested_amount: extra, reason: get('reason') }] : []),
    ],
  });
  if (!parsed.success)
    invalid(
      `필수 출발지·도착지, 청구수량(소수 3자리 이하), 추가비 사유를 확인하세요. ${parsed.error.issues.some((i) => i.path.includes('reason')) ? '추가비 사유가 필요합니다.' : ''}`,
    );
  const input: CreateUseInput = parsed.data;
  const rate = await findRate(ctx.db, {
    project_id: project.id,
    counterparty_id: payee.id,
    vehicle_id: vehicle.id,
    use_date: useDate,
    billing_unit: billingUnit,
    direction: 'PAYABLE',
  });
  const warnings: string[] = [];
  if (price === null) warnings.push('단가 없음: 단가 미확정(PENDING)');
  if (quantity === null) warnings.push('청구수량 없음: 운행횟수를 청구수량으로 사용하지 않음');
  if (price !== null && rate && price !== rate.unit_price)
    warnings.push(`계약 단가 ${rate.unit_price.toLocaleString('ko-KR')}원과 파일 단가가 다릅니다.`);
  if (!rate) warnings.push('일치하는 계약 없음: 파일 단가 검토 필요, 부가세 별도 적용');
  const computed =
    price !== null && quantity !== null
      ? computeAmount(quantity, price, rate?.rounding, price === rate?.unit_price ? rate?.min_charge : null)
      : null;
  return { input, price, rate, computed, warnings };
}
async function evaluate(ctx: Context, job: Job, raw: unknown) {
  const selection = previewSchema.parse(raw);
  const payload = job.rows as Payload;
  const sheet = payload.sheets[selection.sheet];
  if (!sheet || selection.header_row > sheet.rows.length) invalid('시트·헤더 행을 확인하세요.');
  if (new Set(Object.values(selection.mapping)).size !== Object.keys(selection.mapping).length)
    invalid('같은 열을 두 항목에 지정할 수 없습니다.');
  const rows: ImportRow[] = [];
  const resolved = new Map<number, Awaited<ReturnType<typeof resolveRow>>>();
  const existing = await ctx.db
    .select({
      use_date: vehicleUses.use_date,
      vehicle_id: vehicleUses.vehicle_id,
      origin: trips.origin,
      destination: trips.destination,
    })
    .from(vehicleUses)
    .innerJoin(trips, eq(trips.vehicle_use_id, vehicleUses.id))
    .where(await accessibleUseFilter(ctx));
  for (let i = selection.header_row; i < sheet.rows.length; i++) {
    const values = sheet.rows[i];
    if (!values.some((v) => v.trim())) continue;
    const row: ImportRow = {
      row: i + 1,
      values,
      status: 'VALID',
      errors: [],
      warnings: [],
      source_row_hash: sha(`${payload.file_hash}:${selection.sheet}:${i + 1}`),
    };
    try {
      const data = await resolveRow(ctx, values, selection.mapping);
      resolved.set(row.row, data);
      row.warnings = data.warnings;
      const [duplicate] = await ctx.db
        .select({ id: vehicleUses.id })
        .from(vehicleUses)
        .where(eq(vehicleUses.source_row_hash, row.source_row_hash));
      if (duplicate) row.status = 'SKIPPED';
      else if (
        existing.some(
          (u) =>
            u.use_date === data.input.use_date &&
            u.vehicle_id === data.input.vehicle_id &&
            normalize(u.origin) === normalize(data.input.trips![0].origin) &&
            normalize(u.destination) === normalize(data.input.trips![0].destination),
        )
      )
        row.warnings.push(
          '중복 의심: 같은 날짜·차량·경로의 기존 사용 건이 있습니다. 실제 반복 운행인지 확인하세요.',
        );
    } catch (error) {
      if (!(error instanceof AppError || error instanceof z.ZodError || error instanceof RangeError))
        throw error;
      row.status = 'ERROR';
      row.errors = [error instanceof AppError ? error.message : '입력값 형식·금액 범위를 확인하세요.'];
    }
    rows.push(row);
  }
  return { selection, rows, resolved };
}
function summarize(rows: ImportRow[]): ImportSummary {
  return {
    valid: rows.filter((r) => r.status === 'VALID').length,
    errors: rows.filter((r) => r.status === 'ERROR').length,
    skipped: rows.filter((r) => r.status === 'SKIPPED').length,
    success: rows.filter((r) => r.use_id).length,
  };
}
export async function previewImport(ctx: Context, id: string, raw: unknown) {
  return atomic(ctx, async (tx) => {
    const job = await jobFor(tx, id, true);
    if (job.status !== 'PREVIEW') invalid('완료된 작업은 매핑을 변경할 수 없습니다.');
    const result = await evaluate(tx, job, raw);
    const [saved] = await tx.db
      .update(importJobs)
      .set({
        mapping: result.selection,
        rows: { ...(job.rows as Payload), preview: result.rows },
        summary: summarize(result.rows),
        updated_at: new Date(),
      })
      .where(eq(importJobs.id, id))
      .returning();
    return view(saved, tx.user.name);
  });
}
export async function commitImport(ctx: Context, id: string) {
  return atomic(ctx, async (tx) => {
    const job = await jobFor(tx, id, true);
    if (job.status === 'COMMITTED') return getImport(tx, id);
    if (!job.mapping) invalid('먼저 매핑과 미리보기를 확인하세요.');
    await tx.db.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`import:${(job.rows as Payload).file_hash}`}, 0))`,
    );
    const result = await evaluate(tx, job, job.mapping);
    for (const row of result.rows) {
      if (row.status !== 'VALID') continue;
      const data = result.resolved.get(row.row)!;
      // The job lock + unique source hash provide idempotency. A caller-controlled
      // client_request_id must never let an import attach to an existing use.
      const use = await createUse(tx, data.input);
      await tx.db
        .update(vehicleUses)
        .set({ source_row_hash: row.source_row_hash, import_job_id: id })
        .where(eq(vehicleUses.id, use.id));
      // Imported prices are proposals; no approval or submission is performed here.
      await tx.db
        .update(chargeLines)
        .set({
          unit_price: data.price,
          rate_agreement_id: data.price === null ? null : (data.rate?.id ?? null),
          computed_amount: data.computed,
          price_status: data.computed === null ? 'PENDING' : 'CONFIRMED',
          approved_amount: null,
          tax_amount: null,
          line_review_status: 'PENDING',
          agreement_snapshot:
            data.price === null
              ? null
              : {
                  ...data.rate,
                  unit_price: data.price,
                  contract_unit_price: data.rate?.unit_price ?? null,
                  min_charge: data.price === data.rate?.unit_price ? data.rate?.min_charge : null,
                  source: 'IMPORT',
                  imported_unit_price: data.price,
                  import_job_id: id,
                },
          updated_at: new Date(),
        })
        .where(and(eq(chargeLines.vehicle_use_id, use.id), eq(chargeLines.charge_type, 'BASE')));
      row.use_id = use.id;
      await audit(tx, 'IMPORT_ROW', 'vehicle_use', use.id, null, {
        import_job_id: id,
        source_row_hash: row.source_row_hash,
        imported_unit_price: data.price,
        warnings: row.warnings,
      });
    }
    const summary = summarize(result.rows);
    const [saved] = await tx.db
      .update(importJobs)
      .set({
        status: 'COMMITTED',
        committed_at: new Date(),
        rows: { ...(job.rows as Payload), preview: result.rows },
        summary,
        updated_at: new Date(),
      })
      .where(eq(importJobs.id, id))
      .returning();
    await audit(tx, 'IMPORT_COMMIT', 'import_job', id, null, summary);
    return view(saved, tx.user.name);
  });
}
export async function getImport(ctx: Context, id: string) {
  const job = await jobFor(ctx, id);
  const uses = await ctx.db.select().from(vehicleUses).where(eq(vehicleUses.import_job_id, id));
  for (const use of uses) await assertProjectAccess(ctx, use.project_id);
  return view(job, ctx.user.name);
}
export async function listImports(ctx: Context) {
  await manager(ctx);
  const jobs = await ctx.db
    .select()
    .from(importJobs)
    .where(eq(importJobs.created_by, ctx.user.id))
    .orderBy(desc(importJobs.created_at))
    .limit(100);
  return jobs.map((job) => ({
    id: job.id,
    file_name: job.file_name,
    created_at: job.created_at,
    created_by_name: ctx.user.name,
    status: job.status,
    summary: job.summary as ImportSummary | null,
  }));
}
export async function listImportPresets(ctx: Context) {
  await manager(ctx);
  return ctx.db
    .select()
    .from(importPresets)
    .where(eq(importPresets.created_by, ctx.user.id))
    .orderBy(desc(importPresets.created_at));
}
export async function saveImportPreset(ctx: Context, raw: unknown) {
  const input = presetSchema.parse(raw);
  return atomic(ctx, async (tx) => {
    await manager(tx);
    const [saved] = await tx.db
      .insert(importPresets)
      .values({ ...input, created_by: tx.user.id })
      .onConflictDoUpdate({
        target: [importPresets.created_by, importPresets.name],
        set: { mapping: input.mapping },
      })
      .returning();
    await audit(tx, 'IMPORT_PRESET', 'import_preset', saved.id, null, input);
    return saved;
  });
}
export async function importErrors(ctx: Context, id: string) {
  const job = await getImport(ctx, id);
  if (!job.selection) invalid('먼저 미리보기를 실행하세요.');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('오류 행');
  const headers = job.sheets[job.selection.sheet].rows[job.selection.header_row - 1];
  sheet.addRow(['원본 행', ...headers, '오류 사유']);
  for (const row of job.preview.filter((r) => r.status === 'ERROR'))
    sheet.addRow([row.row, ...row.values, row.errors.join('; ')]);
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((col) => {
    col.width = 22;
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
