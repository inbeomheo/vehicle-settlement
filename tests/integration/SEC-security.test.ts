import { randomUUID } from 'node:crypto';
import { it, expect, vi, afterEach } from 'vitest';
import webPush from 'web-push';
import { testDatabase } from '../helpers/database';
import { factories, setupScenario } from '../helpers/factories';
import { withDatabase } from '../../src/server/db/client';

import { createJoinLink, registerDriver } from '../../src/server/services/driver-join';
import { createPasswordReset, resetPassword } from '../../src/server/services/password';
import { createUse, submitUse } from '../../src/server/services/uses';
import { sendUsePush } from '../../src/server/push/send';
import { GET as directory } from '../../src/app/api/drivers/route';
import { GET as master } from '../../src/app/api/admin/[resource]/route';
import { GET as lookups } from '../../src/app/api/lookups/route';

import { POST as subscribe } from '../../src/app/api/push/subscriptions/route';
import { GET as me } from '../../src/app/api/me/route';
import { login } from '../../src/server/services/auth';
const database = testDatabase();
async function request(
  handler: import('../../src/server/http').RouteHandler,
  path: string,
  token?: string,
  body?: unknown,
  params = {},
) {
  const headers = new Headers();
  if (token) headers.set('cookie', `sid=${token}`);
  if (body) headers.set('content-type', 'application/json');
  return withDatabase(database().db, () =>
    handler(
      new Request(`http://localhost:3174${path}`, {
        method: body ? 'POST' : 'GET',
        headers,
        body: body ? JSON.stringify(body) : undefined,
      }),
      { params: Promise.resolve(params) },
    ),
  );
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('SEC-01 현장 기사목록의 제한을 기존 master/lookups API로 우회할 수 없어야 한다', async () => {
  const f = factories(database().db);
  const [a, b] = [await f.project({ name: '담당 현장' }), await f.project({ name: '접근 불가 현장' })];
  const manager = await f.user({ role: 'SITE_MANAGER' });
  await f.assignment(manager.id, a.id);
  const victim = await f.driver({
    name: '외부현장 기사',
    phone: '01099998888',
  });
  const victimUser = await f.user({ role: 'DRIVER', driver_id: victim.id });
  await f.assignment(victimUser.id, b.id);
  const secretParty = await f.counterparty({
    name: '외부현장 거래처',
    phone: '01088889999',
    bank_account: 'TEST-BANK-SECRET',
  });
  await f.affiliation(victim.id, secretParty.id);
  const session = await f.session(manager.id);
  const scoped = await request(directory, '/api/drivers', session.token);
  expect(JSON.stringify(await scoped.json())).not.toContain(victim.id);
  const leaked = await request(master, '/api/admin/drivers', session.token, undefined, {
    resource: 'drivers',
  });
  const options = await request(lookups, '/api/lookups', session.token);
  const parties = await request(master, '/api/admin/counterparties', session.token, undefined, {
    resource: 'counterparties',
  });
  const payloads = [await leaked.json(), await options.json(), await parties.json()];
  expect(leaked.status).toBe(403);
  expect(parties.status).toBe(403);
  expect(JSON.stringify(payloads)).not.toContain(secretParty.bank_account!);
  expect(JSON.stringify(payloads), '다른 현장 기사의 연락처가 반환됨').not.toContain(victim.phone!);
});

it('SEC-02 남의 사업자번호로 공개 가입해서 기존 계약단가를 읽을 수 없어야 한다', async () => {
  const f = factories(database().db);
  const admin = await f.user();
  const project = await f.project();
  const victimParty = await f.counterparty({
    kind: 'DRIVER_BUSINESS',
    biz_no: '777-77-77777',
    name: '피해 기사 사업자',
  });
  const victimVehicle = await f.vehicle();
  const victim = await f.driver({
    phone: '01011119999',
    default_vehicle_id: victimVehicle.id,
  });
  await f.affiliation(victim.id, victimParty.id);
  await f.rate(victimParty.id, {
    project_id: project.id,
    unit_price: 876543,
  });
  const link = await createJoinLink(f.context(admin), {
    project_ids: [project.id],
  });
  await expect(
    registerDriver(database().db, randomUUID(), new URL(link.join_url).pathname.split('/').at(-1)!, {
      client_request_id: randomUUID(),
      login_id: `attacker-${randomUUID()}`,
      password: 'attacker-password',
      profile: {
        name: '공격자',
        phone: '01022229999',
        business_name: '무관한 다른 회사',
        biz_no: '7777777777',
        plate_no: '서울99가9999',
        vehicle_type: '카고',
        tonnage: '1',
      },
    }),
  ).rejects.toMatchObject({
    code: 'VALIDATION_FAILED',
    message: expect.stringContaining('이미 등록된 사업자번호'),
  });
});

it('SEC-03 비밀번호 재설정으로 폐기한 기기에는 이후 운행 푸시가 발송되면 안 된다', async () => {
  const s = await setupScenario(database().db);
  const vapid = webPush.generateVAPIDKeys();
  vi.stubEnv('VAPID_PUBLIC_KEY', vapid.publicKey);
  vi.stubEnv('VAPID_PRIVATE_KEY', vapid.privateKey);
  vi.stubEnv('VAPID_SUBJECT', 'mailto:test@example.com');
  const sender = vi.spyOn(webPush, 'sendNotification').mockResolvedValue({ statusCode: 201 });
  const stolenSession = await s.f.session(s.admin.id);
  const endpoint = `https://fcm.googleapis.com/fcm/send/attacker-${randomUUID()}`;
  expect(
    (
      await request(subscribe, '/api/push/subscriptions', stolenSession.token, {
        endpoint,
        keys: {
          p256dh: vapid.publicKey,
          auth: Buffer.alloc(16, 1).toString('base64url'),
        },
      })
    ).status,
  ).toBe(200);
  const link = await createPasswordReset(s.adminCtx, s.admin.id);
  await resetPassword(database().db, randomUUID(), new URL(link.reset_url).pathname.split('/').at(-1)!, {
    password: 'replacement-password',
    password_confirmation: 'replacement-password',
  });
  expect((await request(me, '/api/me', stolenSession.token)).status).toBe(401);
  let use = await createUse(s.driverCtx, {
    ...s.input,
    charge_lines: [{ charge_type: 'BASE', requested_amount: 654321 }],
  });
  use = await submitUse(s.driverCtx, use.id, { version: use.version });
  await sendUsePush(database().db, use.id, 'SUBMITTED', use.version);
  expect(sender.mock.calls.length, '폐기된 기기의 endpoint로 기사명·현장·경로·금액 발송').toBe(0);
});

it('SEC-04 공격자의 정상 로그인으로 동일 IP의 타 계정 실패 횟수를 지울 수 없어야 한다', async () => {
  const f = factories(database().db);
  const own = await f.user({ role: 'SITE_MANAGER' });
  const ip = '192.0.2.55';
  const { loginThrottleKey, LOGIN_IP_FAILURE_LIMIT } = await import('../../src/server/auth/login-throttle');
  await database().pool.query("INSERT INTO login_throttles (scope,key,failures) VALUES ('IP',$1,$2)", [
    loginThrottleKey('IP', ip),
    LOGIN_IP_FAILURE_LIMIT - 20,
  ]);
  const statuses: string[] = [];
  for (let block = 0; block < 2; block++) {
    for (let i = 0; i < 19; i++) {
      try {
        await login(
          database().db,
          randomUUID(),
          { login_id: `unknown-${randomUUID()}`, password: 'wrong-password' },
          ip,
        );
      } catch (error) {
        statuses.push((error as { code: string }).code);
      }
    }
    await login(database().db, randomUUID(), { login_id: own.login_id, password: 'password1234' }, ip).catch(
      (error: { code: string }) => statuses.push(error.code),
    );
  }
  expect(statuses, '정상 로그인을 섞어도 시간 창의 IP 실패 제한은 유지해야 함').toContain('LOGIN_THROTTLED');
});

it('SEC-05 가입 재전송과 비밀번호 재설정 경합에서 옛 암호로 새 세션이 발급되면 안 된다', async () => {
  const f = factories(database().db);
  const admin = await f.user();
  const project = await f.project();
  const link = await createJoinLink(f.context(admin), {
    project_ids: [project.id],
  });
  const token = new URL(link.join_url).pathname.split('/').at(-1)!;
  const input = {
    client_request_id: randomUUID(),
    login_id: `race-${randomUUID()}`,
    password: 'old-password',
    profile: {
      name: '경합 기사',
      phone: '01033339999',
      business_name: '경합 회사',
      biz_no: '5555555555',
      plate_no: '경기55가5555',
      vehicle_type: '카고',
      tonnage: '1',
    },
  };
  const joined = await registerDriver(database().db, randomUUID(), token, input);
  const reset = await createPasswordReset(f.context(admin), joined.user.id);
  // Pause only the INSERT timing through a trigger in this disposable DB.
  // No authentication function or password comparison is mocked.
  const pool = database().pool;
  await pool.query(
    `CREATE FUNCTION sec_pause_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(916105); RETURN NEW; END; $$`,
  );
  await pool.query(
    `CREATE TRIGGER sec_pause_session BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION sec_pause_session()`,
  );
  const gate = await pool.connect();
  await gate.query('SELECT pg_advisory_lock(916105)');
  const replay = registerDriver(database().db, randomUUID(), token, input);
  let resetWork: Promise<unknown> | undefined;
  try {
    let waiting = false;
    for (let i = 0; i < 200; i++) {
      const state = await pool.query(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory' AND query ILIKE '%sessions%'",
      );
      if (state.rows[0].n) {
        waiting = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(waiting, '가입 재전송이 실제 비밀번호 검사 후 세션 INSERT에 도달').toBe(true);
    resetWork = resetPassword(
      database().db,
      randomUUID(),
      new URL(reset.reset_url).pathname.split('/').at(-1)!,
      { password: 'new-password', password_confirmation: 'new-password' },
    );
    // On the vulnerable code reset finishes; with the fix it waits for users.
    let finished = false;
    void resetWork.then(() => {
      finished = true;
    });
    await vi.waitFor(async () => {
      const state = await pool.query(
        "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%users%'",
      );
      expect(finished || state.rowCount! > 0).toBe(true);
    });
  } finally {
    await gate.query('SELECT pg_advisory_unlock(916105)');
    gate.release();
  }
  const replayed = await replay;
  await resetWork;
  await pool.query('DROP TRIGGER sec_pause_session ON sessions');
  await pool.query('DROP FUNCTION sec_pause_session()');
  const oldResponse = await request(me, '/api/me', joined.token);
  const freshResponse = await request(me, '/api/me', replayed.token);
  expect(oldResponse.status).toBe(401);
  expect(freshResponse.status, 'reset 이후 원래 가입 암호로 만들어진 세션이 유효함').toBe(401);
  await expect(registerDriver(database().db, randomUUID(), token, input)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
});

it('SEC-01 선택지는 역할별 최소 필드·현재 배정·운행 이력으로 제한된다', async () => {
  const { getLookups } = await import('../../src/server/services/lookups');
  const s = await setupScenario(database().db);
  const other = await setupScenario(database().db);
  const manager = await s.f.user({ role: 'SITE_MANAGER' });
  await s.f.assignment(manager.id, s.project.id);
  const customer = await s.f.counterparty({
    kind: 'CUSTOMER',
    bank_account: '비밀계좌',
    phone: '01098765432',
  });
  await s.f.rate(customer.id, { direction: 'RECEIVABLE', project_id: s.project.id });
  const unrelatedCustomer = await s.f.counterparty({ kind: 'CUSTOMER' });
  const future = await s.f.user({ role: 'DRIVER', driver_id: other.driver.id });
  await s.f.assignment(future.id, s.project.id, { valid_from: '2099-01-01' });
  const scoped = await getLookups(s.f.context(manager));
  expect(scoped.drivers.map((row) => row.id)).toEqual([s.driver.id]);
  expect(scoped.vehicles.map((row) => row.id)).toEqual([s.vehicle.id]);
  expect(scoped.counterparties.map((row) => row.id).sort()).toEqual([s.payee.id, customer.id].sort());
  const self = await getLookups(s.driverCtx);
  expect(self.drivers.map((row) => row.id)).toEqual([s.driver.id]);
  expect(self.counterparties.map((row) => row.id)).toEqual([s.payee.id]);
  expect(self.vehicles.map((row) => row.id)).toEqual([s.vehicle.id]);
  for (const data of [scoped, self, await getLookups(s.adminCtx)]) {
    expect(JSON.stringify(data)).not.toMatch(/"(phone|bank_account|biz_no|contact_name)":/);
  }
  expect(JSON.stringify(scoped)).not.toContain(unrelatedCustomer.id);
  const historical = await s.f.driver();
  const vehicle = await s.f.vehicle();
  await s.f.affiliation(historical.id, s.payee.id);
  await createUse(s.adminCtx, { ...s.input, driver_id: historical.id, vehicle_id: vehicle.id });
  expect((await getLookups(s.f.context(manager))).drivers.map((row) => row.id)).toContain(historical.id);
});

it('SEC-02 관리자 기사·소속 등록과 연결된 개별 초대로 같은 사업자의 여러 기사를 추가한다', async () => {
  const { saveMaster } = await import('../../src/server/services/admin');
  const { createInvite, acceptInvite } = await import('../../src/server/services/auth');
  const s = await setupScenario(database().db);
  const driver = await saveMaster(s.adminCtx, 'drivers', { name: '추가 기사', phone: '01067891234' });
  await saveMaster(s.adminCtx, 'affiliations', {
    driver_id: driver.id,
    counterparty_id: s.payee.id,
    valid_from: '2020-01-01',
  });
  const invite = await createInvite(s.adminCtx, {
    role: 'DRIVER',
    name: '추가 기사',
    driver_id: String(driver.id),
    project_ids: [s.project.id],
  });
  const joined = await acceptInvite(
    database().db,
    randomUUID(),
    new URL(invite.invite_url).pathname.split('/').at(-1)!,
    { login_id: `invited-${randomUUID()}`, password: 'password1234' },
  );
  expect(joined.user.driver_id).toBe(driver.id);
});

it('SEC-02 본인 정보 수정으로 기존 타 사업자에 우회 연결할 수 없다', async () => {
  const { updateDriverProfile } = await import('../../src/server/services/driver-profiles');
  const s = await setupScenario(database().db);
  await s.f.counterparty({ kind: 'DRIVER_BUSINESS', biz_no: '987-65-43210' });
  await expect(
    updateDriverProfile(s.driverCtx, s.driverUser.id, {
      name: s.driver.name,
      phone: '01076543210',
      business_name: '남의 사업자',
      biz_no: '987-65-43210',
      plate_no: '서울87아4321',
      vehicle_type: '카고',
      tonnage: '1',
      version: 1,
    }),
  ).rejects.toThrow('이미 등록된 사업자번호');
});

it('SEC-03 비밀번호 변경은 현재 세션 구독만 보존하고 로그아웃·중지는 서버에서 삭제한다', async () => {
  const { changePassword } = await import('../../src/server/services/password');
  const { savePushSubscription } = await import('../../src/server/services/push');
  const { logout } = await import('../../src/server/services/auth');
  const { updateUser } = await import('../../src/server/services/admin');
  const { pushSubscriptions } = await import('../../src/server/db/schema');
  const { eq } = await import('drizzle-orm');
  const s = await setupScenario(database().db);
  const vapid = webPush.generateVAPIDKeys();
  vi.stubEnv('VAPID_PUBLIC_KEY', vapid.publicKey);
  vi.stubEnv('VAPID_PRIVATE_KEY', vapid.privateKey);
  vi.stubEnv('VAPID_SUBJECT', 'mailto:test@example.com');
  const first = await s.f.session(s.driverUser.id);
  const second = await s.f.session(s.driverUser.id);
  const ctx = { ...s.driverCtx, session_id: first.session.id };
  const input = () => ({
    endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
    keys: { p256dh: vapid.publicKey, auth: Buffer.alloc(16, 1).toString('base64url') },
  });
  const mine = input();
  await savePushSubscription(ctx, mine, null);
  await savePushSubscription({ ...ctx, session_id: second.session.id }, input(), null);
  await database()
    .db.insert(pushSubscriptions)
    .values({ user_id: s.driverUser.id, ...input() });
  await changePassword(ctx, {
    current_password: 'password1234',
    password: 'replacement1234',
    password_confirmation: 'replacement1234',
  });
  const rows = () =>
    database().db.select().from(pushSubscriptions).where(eq(pushSubscriptions.user_id, s.driverUser.id));
  expect(await rows()).toMatchObject([{ endpoint: mine.endpoint, session_id: first.session.id }]);
  await expect(
    savePushSubscription({ ...ctx, session_id: second.session.id }, input(), null),
  ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  await logout(ctx);
  expect(await rows()).toHaveLength(0);
  const third = await s.f.session(s.driverUser.id);
  await savePushSubscription({ ...ctx, session_id: third.session.id }, mine, null);
  await updateUser(s.adminCtx, s.driverUser.id, { version: 2, status: 'DISABLED' });
  expect(await rows()).toHaveLength(0);
});

it('SEC-03 발송은 만료·폐기 세션을 정리하고 활성 세션·활성 사용자 옛 구독만 허용한다', async () => {
  const { savePushSubscription } = await import('../../src/server/services/push');
  const { pushSubscriptions, sessions } = await import('../../src/server/db/schema');
  const { eq } = await import('drizzle-orm');
  const s = await setupScenario(database().db);
  const vapid = webPush.generateVAPIDKeys();
  vi.stubEnv('VAPID_PUBLIC_KEY', vapid.publicKey);
  vi.stubEnv('VAPID_PRIVATE_KEY', vapid.privateKey);
  vi.stubEnv('VAPID_SUBJECT', 'mailto:test@example.com');
  const sender = vi.spyOn(webPush, 'sendNotification').mockResolvedValue({ statusCode: 201 });
  const devices = [];
  for (let i = 0; i < 3; i++) {
    const session = await s.f.session(s.admin.id);
    const input = {
      endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
      keys: { p256dh: vapid.publicKey, auth: Buffer.alloc(16, 1).toString('base64url') },
    };
    await savePushSubscription({ ...s.adminCtx, session_id: session.session.id }, input, null);
    devices.push({ session, input });
  }
  await database()
    .db.update(sessions)
    .set({ expires_at: new Date(0) })
    .where(eq(sessions.id, devices[0].session.session.id));
  await database()
    .db.update(sessions)
    .set({ revoked_at: new Date() })
    .where(eq(sessions.id, devices[1].session.session.id));
  const legacy = { ...devices[0].input, endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}` };
  await database()
    .db.insert(pushSubscriptions)
    .values({ user_id: s.admin.id, ...legacy });
  let use = await createUse(s.driverCtx, s.input);
  use = await submitUse(s.driverCtx, use.id, { version: use.version });
  await sendUsePush(database().db, use.id, 'SUBMITTED', use.version);
  expect(sender.mock.calls.map(([subscription]) => subscription.endpoint).sort()).toEqual(
    [legacy.endpoint, devices[2].input.endpoint].sort(),
  );
  expect(
    await database().db.select().from(pushSubscriptions).where(eq(pushSubscriptions.user_id, s.admin.id)),
  ).toHaveLength(2);
  // A new session rebinds the same endpoint; deleting that session cascades.
  const fresh = await s.f.session(s.admin.id);
  await savePushSubscription({ ...s.adminCtx, session_id: fresh.session.id }, devices[2].input, null);
  await database().db.delete(sessions).where(eq(sessions.id, fresh.session.id));
  expect(
    await database()
      .db.select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, devices[2].input.endpoint)),
  ).toHaveLength(0);
  // Expiry observed at HTTP authentication also deletes, without waiting for a send.
  await database()
    .db.insert(pushSubscriptions)
    .values({ user_id: s.admin.id, session_id: devices[0].session.session.id, ...devices[0].input });
  expect((await request(me, '/api/me', devices[0].session.token)).status).toBe(401);
  expect(
    await database()
      .db.select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, devices[0].input.endpoint)),
  ).toHaveLength(0);
});

it('SEC-02 사용 중지된 기사에 연결된 차량도 공용 가입에서 가져올 수 없다', async () => {
  const f = factories(database().db);
  const admin = await f.user();
  const project = await f.project();
  const vehicle = await f.vehicle({ plate_no: '서울88아7654' });
  await f.driver({ active: false, default_vehicle_id: vehicle.id });
  const link = await createJoinLink(f.context(admin), { project_ids: [project.id] });
  await expect(
    registerDriver(database().db, randomUUID(), new URL(link.join_url).pathname.split('/').at(-1)!, {
      client_request_id: randomUUID(),
      login_id: `plate-${randomUUID()}`,
      password: 'password1234',
      profile: {
        name: '차량 중복',
        phone: '01099887766',
        business_name: '새 사업자',
        biz_no: '878-78-78787',
        plate_no: '서울 88아7654',
        vehicle_type: '카고',
        tonnage: '1',
      },
    }),
  ).rejects.toThrow('차량번호');
});
