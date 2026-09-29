import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { importJobs, vehicleUses } from '../../src/server/db/schema';
import { uploadImport, previewImport, commitImport } from '../../src/server/services/import';
import type { Context } from '../../src/server/context';

const database = testDatabase();
type Scenario = Awaited<ReturnType<typeof setupScenario>>;
const header = [
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
];
function row(s: Scenario) {
  return ['2026-09-15', s.project.id, s.driver.id, s.vehicle.id, s.payee.id, '항구', '현장', '일대', '1', ''];
}
async function preview(ctx: Context, rows: string[][]) {
  const job = await uploadImport(
    ctx,
    '운행.csv',
    Buffer.from([header, ...rows].map((r) => r.join(',')).join('\n')),
  );
  return previewImport(ctx, job.id, {
    sheet: 0,
    header_row: 1,
    mapping: job.sheets[0].mapping,
    apply_contract_rate: true,
  });
}

it('동명이지만 서로 다른 담당자에게 배정된 현장은 UUID로 구분하여 각각 등록한다', async () => {
  const s = await setupScenario(database().db);
  const otherProject = await s.f.project({ name: s.project.name });
  const firstManager = await s.f.user({ role: 'SITE_MANAGER' });
  const secondManager = await s.f.user({ role: 'SITE_MANAGER' });
  await s.f.assignment(firstManager.id, s.project.id);
  await s.f.assignment(secondManager.id, otherProject.id);
  const firstContext = s.f.context(firstManager);
  const secondContext = s.f.context(secondManager);
  const values = row(s);
  values[1] = s.project.name;
  const first = await commitImport(firstContext, (await preview(firstContext, [values])).id);
  const second = await preview(secondContext, [values]);
  expect(second.summary).toMatchObject({ valid: 1, skipped: 0, errors: 0 });
  expect(second.preview[0].source_row_hash).not.toBe(first.preview[0].source_row_hash);
  expect((await commitImport(secondContext, second.id)).summary?.success).toBe(1);
  const uses = await database().db.select().from(vehicleUses);
  expect(uses.map((use) => use.project_id).sort()).toEqual([s.project.id, otherProject.id].sort());
  expect(
    (await commitImport(firstContext, (await preview(firstContext, [values])).id)).summary?.success,
  ).toBe(0);
  expect(
    (await commitImport(secondContext, (await preview(secondContext, [values])).id)).summary?.success,
  ).toBe(0);
});

it('이전 작업의 구버전 오류 행 해시가 있어도 정상 파일 미리보기·확정은 성공한다', async () => {
  const s = await setupScenario(database().db);
  const invalid = row(s);
  invalid[0] = '날짜 오류';
  const first = await commitImport(s.adminCtx, (await preview(s.adminCtx, [row(s), invalid])).id);
  const [job] = await database().db.select().from(importJobs).where(eq(importJobs.id, first.id));
  const payload = job.rows as { preview: typeof first.preview };
  payload.preview[1].source_row_hash = createHash('sha256').update('W5-error-row').digest('hex');
  await database().db.update(importJobs).set({ rows: payload }).where(eq(importJobs.id, job.id));
  const next = row(s);
  next[6] = '새 도착지';
  const result = await preview(s.adminCtx, [next]);
  expect(result.summary).toMatchObject({ valid: 1, skipped: 0, errors: 0 });
  expect((await commitImport(s.adminCtx, result.id)).summary?.success).toBe(1);
});

it('검증 실패·제외된 오류 행에는 식별 해시를 저장하지 않고 정상 반복 행은 보존한다', async () => {
  const s = await setupScenario(database().db);
  const invalid = row(s);
  invalid[9] = '1.5';
  const job = await preview(s.adminCtx, [invalid, row(s), row(s)]);
  const selected = await previewImport(s.adminCtx, job.id, { ...job.selection, excluded_rows: [2] });
  const result = await commitImport(s.adminCtx, selected.id);
  expect(result.summary).toMatchObject({ skipped: 1, success: 2 });
  expect(result.preview[0].source_row_hash).toBe('');
  expect(new Set(result.preview.slice(1).map((r) => r.source_row_hash)).size).toBe(2);
  const [saved] = await database().db.select().from(importJobs).where(eq(importJobs.id, job.id));
  expect((saved.rows as { preview: typeof result.preview }).preview[0].source_row_hash).toBe('');
  const again = await preview(s.adminCtx, [row(s), row(s)]);
  expect((await commitImport(s.adminCtx, again.id)).summary?.success).toBe(0);
});
