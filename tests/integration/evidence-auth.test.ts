import { afterAll, beforeAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { callRoute } from '../helpers/routes';
import { createUse, getUse, submitUse, approveUse } from '../../src/server/services/uses';
import {
  createEvidence,
  deleteEvidence,
  downloadEvidence,
  replaceEvidence,
  uploadEvidence,
} from '../../src/server/services/evidence';
import { evidence, projectAssignments, users } from '../../src/server/db/schema';
import { GET as fileRoute } from '../../src/app/api/evidence/[id]/file/route';
import { GET as useRoute } from '../../src/app/api/uses/[id]/route';
import { POST as metadataRoute } from '../../src/app/api/uses/[id]/evidence/route';
import { PUT as uploadRoute } from '../../src/app/api/evidence/[id]/content/route';
const database = testDatabase();
let storage: string;
let previousStorage: string | undefined;
beforeAll(async () => {
  previousStorage = process.env.STORAGE_DIR;
  storage = await mkdtemp(path.join(tmpdir(), 'vehicle-evidence-'));
  process.env.STORAGE_DIR = storage;
});
afterAll(async () => {
  process.env.STORAGE_DIR = previousStorage;
  if (previousStorage === undefined) delete process.env.STORAGE_DIR;
  await rm(storage, { recursive: true, force: true });
});
const bytes = Buffer.from('%PDF-1.7\ntest evidence\n%%EOF');
it('(h) 업로드 실패 후 증빙만 재전송, 운행과 증빙 중복 없음', async () => {
  const s = await setupScenario(database().db, { evidence_policy: 'PHOTO_REQUIRED' });
  let use = await createUse(s.driverCtx, {
    ...s.input,
    trips: [{ seq: 1, origin: '상차장', destination: '현장' }],
  });
  const input = {
    client_upload_id: crypto.randomUUID(),
    kind: 'RECEIPT' as const,
    original_name: '인수증.pdf',
    mime: 'application/pdf' as const,
    size: bytes.length,
  };
  const file = await createEvidence(s.driverCtx, use.id, input);
  const token = (await s.f.session(s.driverUser.id)).token;
  const response = await callRoute(database().db, uploadRoute, {
    method: 'PUT',
    path: `/api/evidence/${file.id}/content`,
    params: { id: file.id },
    token,
    rawBody: Buffer.alloc(bytes.length),
    headers: { 'content-type': 'application/pdf' },
  });
  expect(response.status).toBe(422);
  expect((await database().db.select().from(evidence).where(eq(evidence.id, file.id)))[0].upload_status).toBe(
    'FAILED',
  );
  use = await getUse(s.driverCtx, use.id);
  await expect(submitUse(s.driverCtx, use.id, { version: use.version })).rejects.toMatchObject({
    code: 'SUBMIT_BLOCKED',
  });
  expect((await createEvidence(s.driverCtx, use.id, input)).id).toBe(file.id);
  const uploaded = await uploadEvidence(s.driverCtx, file.id, bytes, 'application/pdf');
  expect(uploaded).toMatchObject({ upload_status: 'UPLOADED', size: bytes.length });
  expect(uploaded.sha256).toHaveLength(64);
  await uploadEvidence(s.driverCtx, file.id, bytes, 'application/pdf');
  use = await getUse(s.driverCtx, use.id);
  expect(use.trips).toHaveLength(1);
  expect(use.evidence).toHaveLength(1);
  use = await submitUse(s.driverCtx, use.id, { version: use.version });
  expect(use.review_status).toBe('SUBMITTED');
  expect((await downloadEvidence(s.driverCtx, file.id)).bytes).toEqual(bytes);
});
it('(i) 다른 기사 사용 건·증빙 파일은 404, 기사 응답과 revision에 고객 청구·연락처 없음', async () => {
  const s = await setupScenario(database().db);
  const customer = await s.f.counterparty({ kind: 'CUSTOMER', name: '비공개 고객' });
  await s.f.rate(customer.id, { direction: 'RECEIVABLE', unit_price: 350000 });
  let use = await createUse(s.adminCtx, { ...s.input, customer_counterparty_id: customer.id });
  const file = await createEvidence(s.adminCtx, use.id, {
    client_upload_id: crypto.randomUUID(),
    kind: 'RECEIPT',
    original_name: '인수증.pdf',
    mime: 'application/pdf',
    size: bytes.length,
  });
  await uploadEvidence(s.adminCtx, file.id, bytes, 'application/pdf');
  use = await getUse(s.adminCtx, use.id);
  use = await submitUse(s.adminCtx, use.id, { version: use.version });
  use = await approveUse(s.adminCtx, use.id, { version: use.version });
  const driverB = await s.f.driver();
  const userB = await s.f.user({ role: 'DRIVER', driver_id: driverB.id });
  await s.f.assignment(userB.id, s.project.id);
  const tokenB = (await s.f.session(userB.id)).token;
  for (const [handler, id, suffix] of [
    [useRoute, use.id, 'uses'],
    [fileRoute, file.id, 'evidence'],
  ] as const) {
    const r = await callRoute(database().db, handler, {
      token: tokenB,
      params: { id },
      path: `/api/${suffix}/${id}`,
    });
    expect(r.status).toBe(404);
  }
  const driverView = await getUse(s.driverCtx, use.id);
  expect(driverView.charge_lines).toHaveLength(1);
  const serialized = JSON.stringify(driverView);
  expect(serialized).not.toContain('RECEIVABLE');
  expect(serialized).not.toContain('비공개 고객');
  expect(serialized).not.toContain('010-0000');
});
it('(j) 비활성 사용자 세션과 회수된 배정은 즉시 차단, 멱등 재생도 권한 검사', async () => {
  const s = await setupScenario(database().db);
  const use = await createUse(s.driverCtx, s.input);
  const token = (await s.f.session(s.driverUser.id)).token;
  const key = crypto.randomUUID();
  const options = {
    token,
    method: 'POST',
    path: `/api/uses/${use.id}/evidence`,
    params: { id: use.id },
    headers: { 'idempotency-key': key },
    body: { client_upload_id: crypto.randomUUID(), kind: 'SLIP_NO', text_value: 'S-1' },
  };
  expect((await callRoute(database().db, metadataRoute, options)).status).toBe(200);
  await database()
    .db.update(projectAssignments)
    .set({ revoked_at: new Date() })
    .where(eq(projectAssignments.id, s.assignment.id));
  expect((await callRoute(database().db, useRoute, { token, params: { id: use.id } })).status).toBe(404);
  expect((await callRoute(database().db, metadataRoute, options)).status).toBe(404);
  await expect(getUse(s.driverCtx, use.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await database().db.update(users).set({ status: 'DISABLED' }).where(eq(users.id, s.driverUser.id));
  expect((await callRoute(database().db, useRoute, { token, params: { id: use.id } })).status).toBe(401);
});
it('촬영 금지 현장의 대체증빙 제출과 교체 이력·논리삭제', async () => {
  const s = await setupScenario(database().db, { evidence_policy: 'PHOTO_OR_ALTERNATIVE' });
  let use = await createUse(s.driverCtx, s.input);
  const first = await createEvidence(s.driverCtx, use.id, {
    client_upload_id: crypto.randomUUID(),
    kind: 'SLIP_NO',
    text_value: 'A-001',
  });
  use = await getUse(s.driverCtx, use.id);
  use = await submitUse(s.driverCtx, use.id, { version: use.version });
  use = await approveUse(s.adminCtx, use.id, { version: use.version });
  const second = await replaceEvidence(
    s.driverCtx,
    first.id,
    { client_upload_id: crypto.randomUUID(), kind: 'CONFIRMATION', text_value: '현장 확인 완료' },
    '전표 정정',
  );
  use = await getUse(s.driverCtx, use.id);
  expect(use.review_status).toBe('DRAFT');
  expect(use.evidence.map((e) => e.id)).toEqual([second.id]);
  const [old] = await database().db.select().from(evidence).where(eq(evidence.id, first.id));
  expect(old).toMatchObject({ replaced_by_id: second.id, replace_reason: '전표 정정' });
  await deleteEvidence(s.driverCtx, second.id, '잘못된 증빙');
  use = await getUse(s.driverCtx, use.id);
  await expect(submitUse(s.driverCtx, use.id, { version: use.version })).rejects.toMatchObject({
    code: 'SUBMIT_BLOCKED',
  });
  expect(
    (await database().db.select().from(evidence).where(eq(evidence.id, second.id)))[0].deleted_at,
  ).not.toBeNull();
});
it('PHOTO_REQUIRED 현장은 텍스트만으로 제출 불가; MIME·20MB 검증', async () => {
  const s = await setupScenario(database().db, { evidence_policy: 'PHOTO_REQUIRED' });
  let use = await createUse(s.driverCtx, s.input);
  await createEvidence(s.driverCtx, use.id, {
    client_upload_id: crypto.randomUUID(),
    kind: 'CONFIRMATION',
    text_value: '텍스트',
  });
  use = await getUse(s.driverCtx, use.id);
  await expect(submitUse(s.driverCtx, use.id, { version: use.version })).rejects.toMatchObject({
    code: 'SUBMIT_BLOCKED',
  });
  await expect(
    createEvidence(s.driverCtx, use.id, {
      client_upload_id: crypto.randomUUID(),
      kind: 'PHOTO',
      original_name: '큰파일.jpg',
      mime: 'image/jpeg',
      size: 20 * 1024 * 1024 + 1,
    }),
  ).rejects.toThrow();
});
it('담당자 증빙 교체 후 자동 제출 revision에는 현재 증빙만 포함', async () => {
  const s = await setupScenario(database().db, { evidence_policy: 'PHOTO_OR_ALTERNATIVE' });
  let use = await createUse(s.adminCtx, s.input);
  const old = await createEvidence(s.adminCtx, use.id, {
    client_upload_id: crypto.randomUUID(),
    kind: 'SLIP_NO',
    text_value: 'OLD',
  });
  use = await getUse(s.adminCtx, use.id);
  use = await submitUse(s.adminCtx, use.id, { version: use.version });
  use = await approveUse(s.adminCtx, use.id, { version: use.version });
  const current = await replaceEvidence(
    s.adminCtx,
    old.id,
    { client_upload_id: crypto.randomUUID(), kind: 'SLIP_NO', text_value: 'NEW' },
    '정정',
  );
  use = await getUse(s.adminCtx, use.id);
  expect(use.review_status).toBe('SUBMITTED');
  const snapshotFiles = use.revisions[0].snapshot.evidence as { id: string }[];
  expect(snapshotFiles.map((f) => f.id)).toEqual([current.id]);
});
