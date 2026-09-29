import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { callRoute } from '../helpers/routes';
import { createUse, getUse, updateUse, submitUse, approveUse } from '../../src/server/services/uses';
import {
  createEvidence,
  uploadEvidence,
  downloadEvidence,
  replaceEvidence,
  deleteEvidence,
} from '../../src/server/services/evidence';
import { updateUser } from '../../src/server/services/admin';
import { evidence } from '../../src/server/db/schema';
import { GET as fileRoute } from '../../src/app/api/evidence/[id]/file/route';
import { POST as createRoute } from '../../src/app/api/uses/[id]/evidence/route';
import { confirmed } from './W4-fixtures';

const database = testDatabase();
async function fixture(proxy: boolean) {
  const s = await setupScenario(database().db, { evidence_policy: 'PHOTO_REQUIRED' });
  const use = await createUse(s.adminCtx, s.input);
  const bytes = Buffer.from('%PDF-OLD_DRIVER_PRIVATE');
  const input = {
    client_upload_id: randomUUID(),
    kind: 'CONFIRMATION' as const,
    original_name: '이전기사_비공개.pdf',
    mime: 'application/pdf' as const,
    size: bytes.length,
  };
  const uploader = proxy ? s.adminCtx : s.driverCtx;
  const file = await createEvidence(uploader, use.id, input);
  await uploadEvidence(uploader, file.id, bytes, 'application/pdf');
  const driver = await s.f.driver();
  await s.f.affiliation(driver.id, s.payee.id);
  const user = await s.f.user({ role: 'DRIVER', driver_id: driver.id });
  await s.f.assignment(user.id, s.project.id);
  const current = await getUse(s.adminCtx, use.id);
  const changed = await updateUse(s.adminCtx, use.id, { version: current.version, driver_id: driver.id });
  return {
    ...s,
    use: changed,
    file,
    bytes,
    evidenceInput: input,
    nextDriver: driver,
    nextUser: user,
    nextCtx: s.f.context(user),
  };
}
it.each([true, false])(
  'R11: 제출 전 증빙은 업로더 계정 변경과 무관하게 이전 기사 귀속 (대리=%s)',
  async (proxy) => {
    const s = await fixture(proxy);
    if (!proxy)
      await updateUser(s.adminCtx, s.driverUser.id, {
        version: s.driverUser.version,
        role: 'SITE_MANAGER',
        driver_id: null,
      });
    const detail = await getUse(s.nextCtx, s.use.id);
    expect(detail.revisions).toHaveLength(0);
    expect(detail.evidence).toHaveLength(0);
    expect(JSON.stringify(detail)).not.toContain('이전기사_비공개');
    await expect(downloadEvidence(s.nextCtx, s.file.id)).rejects.toMatchObject({ status: 404 });
    const session = await s.f.session(s.nextUser.id);
    expect(
      (await callRoute(database().db, fileRoute, { token: session.token, params: { id: s.file.id } })).status,
    ).toBe(404);
    expect((await downloadEvidence(s.adminCtx, s.file.id)).bytes).toEqual(s.bytes);
  },
);
it('이전 증빙의 교체·삭제·메타 멱등 재생을 거부하고 새 기사 증빙은 보인다', async () => {
  const s = await fixture(true);
  await expect(
    replaceEvidence(s.nextCtx, s.file.id, { ...s.evidenceInput, client_upload_id: randomUUID() }, '교체'),
  ).rejects.toMatchObject({ status: 404 });
  await expect(deleteEvidence(s.nextCtx, s.file.id, '삭제')).rejects.toMatchObject({ status: 404 });
  await expect(createEvidence(s.nextCtx, s.use.id, s.evidenceInput)).rejects.toMatchObject({ status: 404 });
  const own = await createEvidence(s.nextCtx, s.use.id, {
    ...s.evidenceInput,
    client_upload_id: randomUUID(),
    original_name: '본인.pdf',
  });
  await uploadEvidence(s.nextCtx, own.id, s.bytes, 'application/pdf');
  expect((await getUse(s.nextCtx, s.use.id)).evidence.map((file) => file.id)).toEqual([own.id]);
  expect((await downloadEvidence(s.nextCtx, own.id)).bytes).toEqual(s.bytes);
  expect((await getUse(s.adminCtx, s.use.id)).evidence).toHaveLength(2);
  const [old] = await database().db.select().from(evidence).where(eq(evidence.id, s.file.id));
  expect(old.owner_driver_id).toBe(s.driver.id);
});
it('담당자에서 새 기사로 역할이 바뀐 계정도 과거 HTTP 멱등 응답을 재생할 수 없다', async () => {
  const s = await setupScenario(database().db);
  const use = await createUse(s.adminCtx, s.input);
  const session = await s.f.session(s.admin.id);
  const key = randomUUID();
  const request = {
    method: 'POST',
    path: `/api/uses/${use.id}/evidence`,
    token: session.token,
    params: { id: use.id },
    headers: { 'idempotency-key': key },
    body: { client_upload_id: randomUUID(), kind: 'CONFIRMATION', text_value: '이전기사 비공개' },
  };
  expect((await callRoute(database().db, createRoute, request)).status).toBe(200);
  // A pre-migration cached response has no immutable owner field; replay must
  // still consult the current evidence row rather than trusting that payload.
  await database().pool.query(
    "UPDATE idempotency_keys SET response_body=response_body #- '{data,owner_driver_id}' WHERE user_id=$1 AND key=$2",
    [s.admin.id, key],
  );
  const driver = await s.f.driver();
  await s.f.affiliation(driver.id, s.payee.id);
  const current = await getUse(s.adminCtx, use.id);
  await updateUse(s.adminCtx, use.id, { version: current.version, driver_id: driver.id });
  const otherAdmin = await s.f.user();
  await updateUser(s.f.context(otherAdmin), s.admin.id, {
    version: s.admin.version,
    role: 'DRIVER',
    driver_id: driver.id,
  });
  await s.f.assignment(s.admin.id, s.project.id);
  const newSession = await s.f.session(s.admin.id);
  const replay = await callRoute(database().db, createRoute, { ...request, token: newSession.token });
  expect(replay.status).toBe(404);
  expect(JSON.stringify(await replay.json())).not.toContain('이전기사 비공개');
});
it('이전 증빙은 숨겨도 제출·승인·정산 확정의 필수 증빙으로 인정한다', async () => {
  const s = await fixture(true);
  const detail = await getUse(s.nextCtx, s.use.id);
  expect(detail.evidence).toHaveLength(0);
  const submitted = await submitUse(s.nextCtx, s.use.id, { version: detail.version });
  expect(JSON.stringify(submitted)).not.toContain('이전기사_비공개');
  const approved = await approveUse(s.adminCtx, s.use.id, { version: submitted.version });
  expect((await confirmed(s, [approved.charge_lines[0].id])).status).toBe('CONFIRMED');
});

it('DB의 불변 귀속은 기사 왕복 변경에도 유지되고 본래 기사는 다시 자기 증빙을 본다', async () => {
  const s = await fixture(true);
  let current = await submitUse(s.nextCtx, s.use.id, { version: s.use.version });
  current = await updateUse(s.adminCtx, current.id, { version: current.version, driver_id: s.driver.id });
  expect((await getUse(s.driverCtx, current.id)).evidence.map((file) => file.id)).toEqual([s.file.id]);
  await expect(
    database().pool.query('UPDATE evidence SET owner_driver_id=$1 WHERE id=$2', [s.nextDriver.id, s.file.id]),
  ).rejects.toMatchObject({ code: '23514' });
});
it('귀속 불명(null)은 모든 기사에게 숨기고 담당자는 증빙으로 사용할 수 있다', async () => {
  const s = await setupScenario(database().db, { evidence_policy: 'PHOTO_OR_ALTERNATIVE' });
  const use = await createUse(s.adminCtx, s.input);
  const [unknown] = await database()
    .db.insert(evidence)
    .values({
      vehicle_use_id: use.id,
      owner_driver_id: null,
      uploaded_by: s.admin.id,
      client_upload_id: randomUUID(),
      kind: 'CONFIRMATION',
      text_value: '귀속 불명 확인서',
      upload_status: 'UPLOADED',
    })
    .returning();
  const detail = await getUse(s.driverCtx, use.id);
  expect(detail.evidence).toHaveLength(0);
  expect(detail.restricted_evidence_count).toBe(1);
  expect(detail.restricted_evidence_satisfies_policy).toBe(true);
  await expect(deleteEvidence(s.driverCtx, unknown.id, '삭제')).rejects.toMatchObject({ status: 404 });
  expect((await submitUse(s.driverCtx, use.id, { version: detail.version })).review_status).toBe('SUBMITTED');
});
