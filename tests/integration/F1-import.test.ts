import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { importJobs, rateAgreements, vehicleUses } from '../../src/server/db/schema';
import { uploadImport, previewImport, commitImport } from '../../src/server/services/import';
import { recalculateImportHashes } from '../../src/server/services/import-rehash';

const database = testDatabase();
async function previewRow(s: Awaited<ReturnType<typeof setupScenario>>, apply = true, price = '') {
  const bytes = Buffer.from(
    [
      '사용일,현장,기사,차량번호,지급처,출발지,도착지,과금단위,청구수량,단가',
      `2026-09-15,${s.project.id},${s.driver.id},${s.vehicle.id},${s.payee.id},항구,현장,일대,1,${price}`,
    ].join('\n'),
  );
  const job = await uploadImport(s.adminCtx, 'same.csv', bytes);
  return previewImport(s.adminCtx, job.id, {
    sheet: 0,
    header_row: 1,
    mapping: job.sheets[0].mapping,
    apply_contract_rate: apply,
  });
}
async function importRow(s: Awaited<ReturnType<typeof setupScenario>>, apply = true, price = '') {
  const job = await previewRow(s, apply, price);
  return commitImport(s.adminCtx, job.id);
}

it('계약 단가 변경 후 같은 원본 행을 재가져와도 추가 등록하지 않는다', async () => {
  const s = await setupScenario(database().db);
  const first = await importRow(s);
  expect(first.summary?.success).toBe(1);
  await database().db.update(rateAgreements).set({ active: false }).where(eq(rateAgreements.id, s.rate.id));
  await s.f.rate(s.payee.id, { project_id: s.project.id, unit_price: 400000 });
  const repeated = await importRow(s);
  expect(repeated.summary?.success).toBe(0);
  expect(repeated.preview[0].source_row_hash).toBe(first.preview[0].source_row_hash);
  expect(
    await database().db.select().from(vehicleUses).where(eq(vehicleUses.project_id, s.project.id)),
  ).toHaveLength(1);
});

it.each([false, true])('계약 적용 옵션 %s에서 반대로 바꿔도 중복 등록하지 않는다', async (apply) => {
  const s = await setupScenario(database().db);
  const first = await importRow(s, apply);
  const repeated = await importRow(s, !apply);
  expect(first.summary?.success).toBe(1);
  expect(repeated.summary?.success).toBe(0);
  expect(repeated.preview[0].source_row_hash).toBe(first.preview[0].source_row_hash);
  // 원본의 명시 단가 변경은 다른 행이며 빈 값과 0원도 구분한다.
  expect((await importRow(s, !apply, '0')).summary?.success).toBe(1);
});

it('구버전 계약 적용 단가 해시는 1회 재계산 후 파일을 재등록하지 않는다', async () => {
  const s = await setupScenario(database().db);
  // The old blank-price hash was identical to the explicit applied-price hash.
  const oldHash = (await previewRow(s, true, '300000')).preview[0].source_row_hash;
  const first = await importRow(s);
  await database()
    .db.update(vehicleUses)
    .set({ source_row_hash: oldHash })
    .where(eq(vehicleUses.id, first.preview[0].use_id!));
  const [job] = await database().db.select().from(importJobs).where(eq(importJobs.id, first.id));
  const payload = job.rows as { preview: { source_row_hash: string; source_ids?: unknown }[] };
  payload.preview[0].source_row_hash = oldHash!;
  delete payload.preview[0].source_ids;
  await database().db.update(importJobs).set({ rows: payload }).where(eq(importJobs.id, first.id));
  await database().db.update(rateAgreements).set({ active: false }).where(eq(rateAgreements.id, s.rate.id));
  await s.f.rate(s.payee.id, { project_id: s.project.id, unit_price: 400000 });
  await recalculateImportHashes(database().db);
  expect((await importRow(s)).summary?.success).toBe(0);
  expect((await importRow(s, false)).summary?.success).toBe(0);
  expect(
    await database().db.select().from(vehicleUses).where(eq(vehicleUses.project_id, s.project.id)),
  ).toHaveLength(1);
});
