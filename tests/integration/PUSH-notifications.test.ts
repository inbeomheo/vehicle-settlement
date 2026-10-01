import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import webPush from 'web-push';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { callRoute } from '../helpers/routes';
import { POST, DELETE, GET } from '../../src/app/api/push/subscriptions/route';
import { GET as configRoute } from '../../src/app/api/push/route';
import { POST as submitRoute } from '../../src/app/api/uses/[id]/submit/route';
import { POST as fixRoute } from '../../src/app/api/uses/[id]/request-fix/route';
import { createUse, submitUse } from '../../src/server/services/uses';
import { savePushSubscription } from '../../src/server/services/push';
import { pushRecipients, sendUsePush } from '../../src/server/push/send';
import { pushConfig } from '../../src/server/push/config';
import {
  auditLogs,
  projectAssignments,
  pushSubscriptions,
  users,
  vehicleUses,
} from '../../src/server/db/schema';

const pending = vi.hoisted(() => [] as (() => Promise<void>)[]);
vi.mock('next/server', () => ({ after: (callback: () => Promise<void>) => pending.push(callback) }));
const database = testDatabase();
const vapid = webPush.generateVAPIDKeys();
const subscription = () => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
  keys: { p256dh: vapid.publicKey, auth: Buffer.alloc(16, 1).toString('base64url') },
});
beforeEach(() => {
  vi.stubEnv('VAPID_PUBLIC_KEY', vapid.publicKey);
  vi.stubEnv('VAPID_PRIVATE_KEY', vapid.privateKey);
  vi.stubEnv('VAPID_SUBJECT', 'mailto:push@example.com');
  vi.spyOn(webPush, 'sendNotification').mockResolvedValue({ statusCode: 201 });
  pending.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('본인 구독 upsert·조회·삭제, 타인 소유 변경·삭제 불가, 감사 비밀 제외', async () => {
  const s = await setupScenario(database().db);
  const session = await s.f.session(s.driverUser.id);
  const other = await s.f.session(s.admin.id);
  const input = subscription();
  const options = { method: 'POST', token: session.token, body: input };
  expect((await callRoute(database().db, POST, options)).status).toBe(200);
  expect((await callRoute(database().db, POST, options)).status).toBe(200);
  const rows = await database()
    .db.select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, input.endpoint));
  expect(rows).toHaveLength(1);
  expect(rows[0].user_id).toBe(s.driverUser.id);
  const status = await callRoute(database().db, GET, {
    token: session.token,
    path: `/api/push/subscriptions?endpoint=${encodeURIComponent(input.endpoint)}`,
  });
  expect((await status.json()).data.subscribed).toBe(true);
  expect((await callRoute(database().db, POST, { ...options, token: other.token })).status).toBe(403);
  await callRoute(database().db, DELETE, {
    method: 'DELETE',
    token: other.token,
    body: { endpoint: input.endpoint },
  });
  expect(
    await database()
      .db.select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, input.endpoint)),
  ).toHaveLength(1);
  const audit = JSON.stringify(
    await database().db.select().from(auditLogs).where(eq(auditLogs.entity_type, 'push_subscription')),
  );
  expect(audit).not.toContain(input.endpoint);
  expect(audit).not.toContain(input.keys.auth);
  await callRoute(database().db, DELETE, {
    ...options,
    method: 'DELETE',
    body: { endpoint: input.endpoint },
  });
  await callRoute(database().db, DELETE, {
    ...options,
    method: 'DELETE',
    body: { endpoint: input.endpoint },
  });
  expect(
    await database()
      .db.select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, input.endpoint)),
  ).toHaveLength(0);
});
it('미인증·비활성·다른 출처 거부, 임의 URL·내부 주소·잘못된 키·사용자 주입 거부', async () => {
  const s = await setupScenario(database().db);
  const session = await s.f.session(s.admin.id);
  const input = subscription();
  expect((await callRoute(database().db, POST, { method: 'POST', body: input })).status).toBe(401);
  for (const endpoint of [
    'not-a-url',
    'https://127.0.0.1/a',
    'http://fcm.googleapis.com/a',
    'https://fcm.googleapis.com.evil.test/a',
    'https://fcm.googleapis.com:444/a',
    'https://a@fcm.googleapis.com/a',
  ]) {
    expect(
      (
        await callRoute(database().db, POST, {
          method: 'POST',
          token: session.token,
          body: { ...input, endpoint },
        })
      ).status,
    ).toBe(422);
  }
  for (const body of [
    { ...input, user_id: s.driverUser.id },
    { ...input, keys: { auth: 'x', p256dh: 'x' } },
  ]) {
    expect(
      (await callRoute(database().db, POST, { method: 'POST', token: session.token, body })).status,
    ).toBe(422);
  }
  expect(
    (
      await callRoute(database().db, POST, {
        method: 'POST',
        token: session.token,
        body: input,
        headers: { origin: 'https://evil.test' },
      })
    ).status,
  ).toBe(403);
  await database().db.update(users).set({ status: 'DISABLED' }).where(eq(users.id, s.admin.id));
  expect(
    (await callRoute(database().db, POST, { method: 'POST', token: session.token, body: input })).status,
  ).toBe(401);
});
it('지정 담당자만, 미지정은 유효 검수 권한자 전원, 보완은 본인 기사만; 배정·상태 회수 반영', async () => {
  const s = await setupScenario(database().db);
  const use = await createUse(s.driverCtx, s.input);
  const site = await s.f.user({ role: 'SITE_MANAGER' });
  const assignment = await s.f.assignment(site.id, s.project.id);
  const global = await s.f.user({ role: 'SETTLEMENT_MANAGER', all_projects: true });
  const expired = await s.f.user({ role: 'SITE_MANAGER' });
  await s.f.assignment(expired.id, s.project.id, { valid_to: '2020-01-02' });
  const future = await s.f.user({ role: 'SITE_MANAGER' });
  await s.f.assignment(future.id, s.project.id, { valid_from: '2099-01-01' });
  const disabled = await s.f.user({ status: 'DISABLED' });
  // 시험 기본 입력은 담당자를 지정하므로, 미지정 경우를 따로 만든다.
  const ids = await pushRecipients(database().db, { ...use, reviewer_user_id: null }, 'SUBMITTED');
  expect(ids).toEqual(expect.arrayContaining([s.admin.id, site.id, global.id]));
  for (const id of [s.driverUser.id, expired.id, future.id, disabled.id]) expect(ids).not.toContain(id);
  const selected = { ...use, reviewer_user_id: site.id };
  expect(await pushRecipients(database().db, selected, 'SUBMITTED')).toEqual([site.id]);
  await database()
    .db.update(projectAssignments)
    .set({ revoked_at: new Date() })
    .where(eq(projectAssignments.id, assignment.id));
  expect(await pushRecipients(database().db, selected, 'SUBMITTED')).toEqual([]);
  expect(await pushRecipients(database().db, use, 'NEEDS_FIX')).toEqual([s.driverUser.id]);
  await database()
    .db.update(projectAssignments)
    .set({ revoked_at: new Date() })
    .where(eq(projectAssignments.id, s.assignment.id));
  expect(await pushRecipients(database().db, use, 'NEEDS_FIX')).toEqual([]);
});
it('web-push 경계: 다중 기기·금액·링크, 성공 이력, 404/410 삭제, 일시 실패 수 누적', async () => {
  const s = await setupScenario(database().db);
  let use = await createUse(s.driverCtx, s.input);
  await database()
    .db.update(vehicleUses)
    .set({ reviewer_user_id: s.admin.id })
    .where(eq(vehicleUses.id, use.id));
  use = await submitUse(s.driverCtx, use.id, { version: use.version });
  const inputs = Array.from({ length: 4 }, subscription);
  const session = await s.f.session(s.admin.id);
  for (const input of inputs)
    await savePushSubscription({ ...s.adminCtx, session_id: session.session.id }, input, 'test');
  vi.mocked(webPush.sendNotification).mockImplementation(async ({ endpoint }) => {
    const index = inputs.findIndex((input) => input.endpoint === endpoint);
    if (index > 0) throw { statusCode: [0, 404, 410, 503][index] };
    return { statusCode: 201 };
  });
  await sendUsePush(database().db, use.id, 'SUBMITTED', use.version);
  expect(webPush.sendNotification).toHaveBeenCalledTimes(4);
  const message = JSON.parse(vi.mocked(webPush.sendNotification).mock.calls[0][1]);
  expect(message).toMatchObject({ url: `/m/uses/${use.id}`, title: '운행 확인 요청' });
  expect(message.body).toContain('300,000원');
  expect(message.body).toContain('상차장→현장');
  const remaining = await database()
    .db.select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.user_id, s.admin.id));
  expect(remaining).toHaveLength(2);
  expect(remaining.find((row) => row.endpoint === inputs[0].endpoint)?.last_success_at).toBeInstanceOf(Date);
  expect(remaining.find((row) => row.endpoint === inputs[3].endpoint)?.failure_count).toBe(1);
  await sendUsePush(database().db, use.id, 'SUBMITTED', use.version - 1);
  expect(webPush.sendNotification).toHaveBeenCalledTimes(4);
});
it('커밋 이후 예약, 멱등 재생·실패는 미발송, 보완과 재제출 각각 한 번', async () => {
  const s = await setupScenario(database().db);
  const driver = await s.f.session(s.driverUser.id);
  const admin = await s.f.session(s.admin.id);
  const use = await createUse(s.driverCtx, s.input);
  await database()
    .db.update(vehicleUses)
    .set({ reviewer_user_id: s.admin.id })
    .where(eq(vehicleUses.id, use.id));
  await savePushSubscription({ ...s.adminCtx, session_id: admin.session.id }, subscription(), null);
  await savePushSubscription({ ...s.driverCtx, session_id: driver.session.id }, subscription(), null);
  const options = {
    method: 'POST',
    path: `/api/uses/${use.id}/submit`,
    token: driver.token,
    params: { id: use.id },
    body: { version: use.version },
    headers: { 'idempotency-key': randomUUID() },
  };
  const response = await callRoute(database().db, submitRoute, options);
  expect(response.status).toBe(200);
  expect(pending).toHaveLength(1);
  // A separate pool connection sees the committed status before the callback runs.
  expect(
    (await database().pool.query('SELECT review_status FROM vehicle_uses WHERE id=$1', [use.id])).rows[0]
      .review_status,
  ).toBe('SUBMITTED');
  expect(webPush.sendNotification).not.toHaveBeenCalled();
  await pending.shift()!();
  expect((await callRoute(database().db, submitRoute, options)).headers.get('idempotency-replayed')).toBe(
    'true',
  );
  expect(pending).toHaveLength(0);
  expect((await callRoute(database().db, submitRoute, { ...options, headers: {} })).status).toBe(409);
  expect(pending).toHaveLength(0);
  const submitted = (await response.json()).data;
  const fix = await callRoute(database().db, fixRoute, {
    method: 'POST',
    token: admin.token,
    params: { id: use.id },
    body: {
      version: submitted.version,
      fix_items: [{ target: 'trip:1.destination', message: '도착지 확인' }],
    },
  });
  expect(fix.status).toBe(200);
  await pending.shift()!();
  expect(JSON.parse(vi.mocked(webPush.sendNotification).mock.calls[1][1]).url).toBe(`/d/uses/${use.id}`);
  const fixed = (await fix.json()).data;
  const resubmit = await callRoute(database().db, submitRoute, {
    ...options,
    body: { version: fixed.version },
    headers: { 'idempotency-key': randomUUID() },
  });
  expect(resubmit.status).toBe(200);
  vi.mocked(webPush.sendNotification).mockRejectedValue(new Error('offline'));
  await expect(pending.shift()!()).resolves.toBeUndefined();
  expect(webPush.sendNotification).toHaveBeenCalledTimes(3);
});
it('키 누락·불일치·잘못된 mailto면 조용히 중지, API에 비밀키 없음', async () => {
  const s = await setupScenario(database().db);
  const session = await s.f.session(s.admin.id);
  const configured = await callRoute(database().db, configRoute, { token: session.token });
  expect(JSON.stringify(await configured.json())).not.toContain(vapid.privateKey);
  for (const [name, value] of [
    ['VAPID_PRIVATE_KEY', ''],
    ['VAPID_SUBJECT', 'https://example.com'],
    ['VAPID_PUBLIC_KEY', 'bad'],
  ]) {
    vi.stubEnv(name, value);
    expect(pushConfig()).toBeNull();
    expect(await savePushSubscription(s.adminCtx, subscription(), null)).toEqual({
      enabled: false,
      subscribed: false,
    });
    await sendUsePush(database().db, randomUUID(), 'SUBMITTED', 1);
    vi.stubEnv('VAPID_PUBLIC_KEY', vapid.publicKey);
    vi.stubEnv('VAPID_PRIVATE_KEY', vapid.privateKey);
    vi.stubEnv('VAPID_SUBJECT', 'mailto:push@example.com');
  }
  expect(webPush.sendNotification).not.toHaveBeenCalled();
});
