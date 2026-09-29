import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { callRoute } from '../helpers/routes';
import { vehicleUses } from '../../src/server/db/schema';
import { createUse, updateUse } from '../../src/server/services/uses';
import { POST } from '../../src/app/api/uses/route';
const database = testDatabase();

it('R7-2 다른 헤더 멱등 키로 보내도 같은 client_request_id의 다른 본문은 422다', async () => {
  const s = await setupScenario(database().db);
  const token = (await s.f.session(s.driverUser.id)).token;
  const input = { ...s.input, client_request_id: crypto.randomUUID(), notes: '최초 내용' };
  const create = (body: unknown) =>
    callRoute(database().db, POST, {
      path: '/api/uses',
      method: 'POST',
      token,
      body,
      headers: { 'idempotency-key': crypto.randomUUID() },
    });
  expect((await create(input)).status).toBe(200);
  const changed = await create({ ...input, notes: '나중 내용', quantity: '2' });
  expect(changed.status).toBe(422);
  expect((await changed.json()).error.code).toBe('IDEMPOTENCY_MISMATCH');
  const rows = await database()
    .db.select()
    .from(vehicleUses)
    .where(eq(vehicleUses.client_request_id, input.client_request_id));
  expect(rows).toHaveLength(1);
  expect(rows[0].notes).toBe('최초 내용');
});

it('R7-2 생성 해시는 후속 PATCH와 무관하고 키 순서가 다른 원래 본문도 재생한다', async () => {
  const s = await setupScenario(database().db);
  const input = { ...s.input, client_request_id: crypto.randomUUID(), notes: '최초' };
  const use = await createUse(s.driverCtx, input);
  await updateUse(s.driverCtx, use.id, { version: use.version, notes: '수정' });
  const replay = await createUse(
    s.driverCtx,
    Object.fromEntries(Object.entries(input).reverse()) as typeof input,
  );
  expect(replay.id).toBe(use.id);
  expect(replay.notes).toBe('수정');
  await expect(createUse(s.driverCtx, { ...input, notes: '수정' })).rejects.toMatchObject({
    code: 'IDEMPOTENCY_MISMATCH',
  });
});

it('R7-2 동시에 다른 본문을 보내도 한 건만 생성하고 나머지는 불일치로 거부한다', async () => {
  const s = await setupScenario(database().db);
  const input = { ...s.input, client_request_id: crypto.randomUUID() };
  const results = await Promise.allSettled([
    createUse(s.driverCtx, { ...input, notes: '첫 요청' }),
    createUse(s.driverCtx, { ...input, notes: '두 번째 요청' }),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.find((result) => result.status === 'rejected')).toMatchObject({
    reason: { code: 'IDEMPOTENCY_MISMATCH' },
  });
  expect(
    await database()
      .db.select()
      .from(vehicleUses)
      .where(eq(vehicleUses.client_request_id, input.client_request_id)),
  ).toHaveLength(1);
});

it('R7-2 생성 본문 해시가 없는 과거 건은 원본을 추측하지 않고 불일치로 안내한다', async () => {
  const s = await setupScenario(database().db);
  const input = { ...s.input, client_request_id: crypto.randomUUID() };
  const use = await createUse(s.driverCtx, input);
  await database()
    .db.update(vehicleUses)
    .set({ create_request_hash: null })
    .where(eq(vehicleUses.id, use.id));
  await expect(createUse(s.driverCtx, input)).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' });
});
