import { expect, it, vi, afterEach } from 'vitest';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { createUse } from '../../src/server/services/uses';
import { uploadImport, previewImport, commitImport } from '../../src/server/services/import';
import { withDatabase } from '../../src/server/db/client';
import { POST as importUpload } from '../../src/app/api/import/upload/route';
import { GET as importDetail } from '../../src/app/api/import/[id]/route';
import type { RouteHandler } from '../../src/server/http';

const database = testDatabase();
afterEach(() => vi.unstubAllEnvs());
async function request(handler: RouteHandler, token: string, path: string, params = {}) {
  return withDatabase(database().db, () =>
    handler(
      new Request(`http://localhost:3181${path}`, {
        headers: { cookie: `sid=${token}` },
      }),
      { params: Promise.resolve(params) },
    ),
  );
}

it('100행 뒤 경고·오류는 전부 보이고 정상 행은 서버 저장본으로 페이지 이동·제외한다', async () => {
  const s = await setupScenario(database().db);
  await createUse(s.adminCtx, { ...s.input, trips: [{ seq: 1, origin: '출발', destination: '중복' }] });
  const header = '사용일,현장,기사,차량번호,지급처,출발지,도착지,과금단위,단가';
  const lines = Array.from(
    { length: 205 },
    (_, i) =>
      `2026-09-15,${s.project.id},${s.driver.id},${s.vehicle.id},${s.payee.id},출발,${i === 102 ? '중복' : `도착${i}`},일대,${i === 101 ? 310000 : 300000}`,
  );
  lines[204] = '잘못된 행';
  const job = await uploadImport(s.adminCtx, '페이지.csv', Buffer.from([header, ...lines].join('\n')));
  const selection = { sheet: 0, header_row: 1, mapping: job.sheets[0].mapping };
  const preview = await previewImport(s.adminCtx, job.id, selection);
  expect(preview.preview_total).toBe(205);
  expect(preview.preview.find((r) => r.row === 103)).not.toHaveProperty('source_ids');
  expect(preview.preview.find((r) => r.row === 103)).not.toHaveProperty('source_row_hash');
  expect(preview.preview.find((r) => r.row === 103)?.warnings.join()).toContain('계약 단가');
  expect(preview.preview.find((r) => r.row === 104)?.warnings.join()).toContain('중복 의심');
  expect(preview.preview.find((r) => r.row === 206)?.status).toBe('ERROR');
  const session = await s.f.session(s.admin.id);
  const response = await request(importDetail, session.token, `/api/import/${job.id}?page=2`, { id: job.id });
  const body = (await response.json()).data;
  expect(response.status).toBe(200);
  expect(body.preview_page).toBe(2);
  expect(body.preview_warning_total).toBe(2);
  expect(body.preview.find((r: { row: number }) => r.row === 202)).toBeDefined();
  expect(body.preview.find((r: { row: number }) => r.row === 2)).toBeUndefined();
  expect(Buffer.byteLength(JSON.stringify({ data: preview }))).toBeLessThanOrEqual(4 * 1024 * 1024);
  const excluded = await previewImport(s.adminCtx, job.id, {
    ...selection,
    excluded_rows: [103, 104, 202, 206],
  });
  expect(excluded.summary).toMatchObject({ skipped: 4, errors: 0, valid: 201 });
  const saved = await commitImport(s.adminCtx, job.id);
  expect(saved.summary?.success).toBe(201);
  expect(
    (await request(importDetail, session.token, `/api/import/${job.id}?page=0`, { id: job.id })).status,
  ).toBe(422);
  const other = await s.f.user();
  const otherSession = await s.f.session(other.id);
  expect(
    (await request(importDetail, otherSession.token, `/api/import/${job.id}?page=2`, { id: job.id })).status,
  ).toBe(404);
});

it.each(['', '1'])('가져오기 파일 상한은 로컬·배포(%s) 모두 multipart 여유를 남긴 4MiB다', async (vercel) => {
  const s = await setupScenario(database().db);
  vi.stubEnv('VERCEL', vercel);
  const limit = 4 * 1024 * 1024 - 64 * 1024;
  const line = Array(100).fill('a'.repeat(40)).join(',') + '\n';
  const bytes = Buffer.from(line.repeat(Math.ceil(limit / line.length)).slice(0, limit));
  const session = await s.f.session(s.admin.id);
  const form = new FormData();
  form.set('file', new File([bytes], '한도.csv', { type: 'text/csv' }));
  const response = await withDatabase(database().db, () =>
    importUpload(
      new Request('http://localhost:3181/api/import/upload', {
        method: 'POST',
        headers: { cookie: `sid=${session.token}` },
        body: form,
      }),
      { params: Promise.resolve({}) },
    ),
  );
  expect(response.status).toBe(200);
  await expect(
    uploadImport(s.adminCtx, '큰파일.csv', Buffer.concat([bytes, Buffer.from('a')])),
  ).rejects.toThrow('3.94MB 이하로 나눠');
  // Reject an oversized streamed multipart body even without Content-Length.
  const oversized = await withDatabase(database().db, () =>
    importUpload(
      new Request('http://localhost:3181/api/import/upload', {
        method: 'POST',
        headers: { cookie: `sid=${session.token}`, 'content-type': 'multipart/form-data; boundary=test' },
        body: Buffer.alloc(4 * 1024 * 1024 + 1),
      }),
      { params: Promise.resolve({}) },
    ),
  );
  expect(oversized.status).toBe(422);
  expect(JSON.stringify(await oversized.json())).toContain('나눠');
});
