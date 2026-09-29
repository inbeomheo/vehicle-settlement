import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { importJobs, vehicleUses } from '../../src/server/db/schema';
import { uploadImport, previewImport, commitImport } from '../../src/server/services/import';
import { recalculateImportHashes, type ImportRehashLog } from '../../src/server/services/import-rehash';
import { getUse, updateUse } from '../../src/server/services/uses';

const database = testDatabase();
type Scenario = Awaited<ReturnType<typeof setupScenario>>;
type Result = Awaited<ReturnType<typeof commitImport>>;
const oldHash = (value: string) => createHash('sha256').update(`old:${value}`).digest('hex');
async function preview(s: Scenario, destinations: string[]) {
  const bytes = Buffer.from(
    [
      '사용일,현장,기사,차량번호,지급처,출발지,도착지,과금단위,청구수량,단가',
      ...destinations.map(
        (destination) =>
          `2026-09-15,${s.project.id},${s.driver.id},${s.vehicle.id},${s.payee.id},항구,${destination},일대,1,`,
      ),
    ].join('\n'),
  );
  const job = await uploadImport(s.adminCtx, '운행.csv', bytes);
  return previewImport(s.adminCtx, job.id, {
    sheet: 0,
    header_row: 1,
    mapping: job.sheets[0].mapping,
    apply_contract_rate: true,
  });
}
async function replaceHashes(job: Result, change?: (rows: Result['preview']) => void) {
  const [stored] = await database().db.select().from(importJobs).where(eq(importJobs.id, job.id));
  const payload = stored.rows as { preview: Result['preview']; file_hash?: string };
  payload.file_hash = oldHash(job.id);
  for (const row of payload.preview) {
    row.source_row_hash = oldHash(`${job.id}:${row.row}`);
    delete row.source_ids;
    if (row.use_id)
      await database()
        .db.update(vehicleUses)
        .set({ source_row_hash: row.source_row_hash })
        .where(eq(vehicleUses.id, row.use_id));
  }
  change?.(payload.preview);
  await database().db.update(importJobs).set({ rows: payload }).where(eq(importJobs.id, job.id));
}

it('재계산은 수정된 사용 건 대신 당시 UUID·원본 값을 사용하며 반복 실행해도 내용·금액·버전을 보존한다', async () => {
  const s = await setupScenario(database().db);
  const job = await commitImport(s.adminCtx, (await preview(s, ['원본 도착지'])).id);
  await replaceHashes(job);
  const id = job.preview[0].use_id!;
  const original = await getUse(s.adminCtx, id);
  const project = await s.f.project();
  await updateUse(s.adminCtx, id, {
    version: original.version,
    project_id: project.id,
    quantity: '3',
    notes: '나중에 수정',
  });
  const before = await getUse(s.adminCtx, id);
  const logs: ImportRehashLog[] = [];
  await recalculateImportHashes(database().db, (entry) => logs.push(entry));
  expect(logs.filter((entry) => entry.job_id === job.id)).toEqual([]);
  const after = await getUse(s.adminCtx, id);
  expect(after).toEqual({ ...before, source_row_hash: job.preview[0].source_row_hash });
  const [stored] = await database().db.select().from(importJobs).where(eq(importJobs.id, job.id));
  expect(stored.rows).not.toHaveProperty('file_hash');
  expect((stored.rows as { preview: Result['preview'] }).preview[0].source_ids?.project_id).toBe(
    s.project.id,
  );
  expect((await commitImport(s.adminCtx, (await preview(s, ['원본 도착지'])).id)).summary?.success).toBe(0);
  expect((await recalculateImportHashes(database().db)).updated).toBe(0);
  expect(await getUse(s.adminCtx, id)).toEqual(after);
});

it('재계산 중 오류 행은 해시 없이 로그를 남기고 같은 작업의 뒤쪽 정상 행도 처리한다', async () => {
  const s = await setupScenario(database().db);
  const job = await commitImport(s.adminCtx, (await preview(s, ['처음', '손상', '마지막'])).id);
  await replaceHashes(job, (rows) => {
    rows[1].values[0] = '잘못된 날짜';
    rows.push({ ...rows[1], row: 5, status: 'ERROR', errors: ['이전 날짜 오류'], use_id: undefined });
  });
  const logs: ImportRehashLog[] = [];
  await recalculateImportHashes(database().db, (entry) => logs.push(entry));
  expect(logs.filter((entry) => entry.job_id === job.id).map((entry) => entry.row)).toEqual([3, 5]);
  for (const index of [0, 2]) {
    const use = await getUse(s.adminCtx, job.preview[index].use_id!);
    expect(use.source_row_hash).toBe(job.preview[index].source_row_hash);
  }
  const invalid = await getUse(s.adminCtx, job.preview[1].use_id!);
  expect(invalid.source_row_hash).toBeNull();
  const [stored] = await database().db.select().from(importJobs).where(eq(importJobs.id, job.id));
  const rows = (stored.rows as { preview: Result['preview'] }).preview;
  expect([rows[1].source_row_hash, rows[3].source_row_hash]).toEqual(['', '']);
  expect((await commitImport(s.adminCtx, (await preview(s, ['새 정상 파일'])).id)).summary?.success).toBe(1);
});

it('개발 DB의 중복 해시 충돌과 손상된 작업을 건너뛰고 다음 행·작업을 처리한다', async () => {
  const s = await setupScenario(database().db);
  const first = await commitImport(s.adminCtx, (await preview(s, ['동일'])).id);
  await replaceHashes(first);
  const [broken] = await database()
    .db.insert(importJobs)
    .values({
      file_name: '손상.csv',
      created_by: s.admin.id,
      status: 'COMMITTED',
      mapping: {},
      rows: { preview: [] },
    })
    .returning();
  const second = await commitImport(s.adminCtx, (await preview(s, ['동일', '계속 처리'])).id);
  await replaceHashes(second);
  const logs: ImportRehashLog[] = [];
  await recalculateImportHashes(database().db, (entry) => logs.push(entry));
  expect(logs.some((entry) => entry.job_id === broken.id)).toBe(true);
  expect(logs.some((entry) => entry.job_id === second.id && entry.use_id === second.preview[0].use_id)).toBe(
    true,
  );
  expect((await getUse(s.adminCtx, first.preview[0].use_id!)).source_row_hash).toBe(
    first.preview[0].source_row_hash,
  );
  expect((await getUse(s.adminCtx, second.preview[0].use_id!)).source_row_hash).toBeNull();
  expect((await getUse(s.adminCtx, second.preview[1].use_id!)).source_row_hash).toBe(
    second.preview[1].source_row_hash,
  );
  expect(
    (await commitImport(s.adminCtx, (await preview(s, ['동일', '계속 처리'])).id)).summary?.success,
  ).toBe(0);
});
