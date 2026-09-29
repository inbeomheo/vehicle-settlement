import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { callRoute } from '../helpers/routes';
import { importJobs } from '../../src/server/db/schema';
import { DELETE } from '../../src/app/api/import/route';

const database = testDatabase();
it('확인한 ID만 삭제하며 목록 밖·타인·최근·완료 미리보기는 서버에서 보존한다', async () => {
  const s = await setupScenario(database().db);
  const other = await s.f.user({ role: 'ADMIN' });
  const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  const jobs = await database()
    .db.insert(importJobs)
    .values(
      ['선택', '목록 밖', '타인', '최근', '완료'].map((file_name) => ({
        file_name,
        created_by: file_name === '타인' ? other.id : s.admin.id,
        status: file_name === '완료' ? ('COMMITTED' as const) : ('PREVIEW' as const),
        rows: { sheets: [], preview: [] },
        mapping: {},
        created_at: old,
        updated_at: file_name === '최근' ? new Date() : old,
      })),
    )
    .returning();
  const { token } = await s.f.session(s.admin.id);
  const response = await callRoute(database().db, DELETE, {
    method: 'DELETE',
    path: '/api/import',
    token,
    body: { ids: jobs.filter((job) => job.file_name !== '목록 밖').map((job) => job.id) },
    headers: { 'idempotency-key': crypto.randomUUID() },
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: { deleted: 1 } });
  const remaining = await database().db.select().from(importJobs);
  expect(remaining.map((job) => job.file_name).sort()).toEqual(['목록 밖', '타인', '최근', '완료'].sort());
});

it('잘못되거나 빈 삭제 대상은 전체 삭제로 해석하지 않는다', async () => {
  const s = await setupScenario(database().db);
  const [job] = await database()
    .db.insert(importJobs)
    .values({
      file_name: '보존',
      created_by: s.admin.id,
      status: 'PREVIEW',
      rows: {},
      mapping: {},
      updated_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    })
    .returning();
  const { token } = await s.f.session(s.admin.id);
  for (const ids of [[], ['not-a-uuid'], Array(101).fill(job.id)]) {
    const response = await callRoute(database().db, DELETE, {
      method: 'DELETE',
      path: '/api/import',
      token,
      body: { ids },
      headers: { 'idempotency-key': crypto.randomUUID() },
    });
    expect(response.status).toBe(422);
    expect(await database().db.select().from(importJobs).where(eq(importJobs.id, job.id))).toHaveLength(1);
  }
});
