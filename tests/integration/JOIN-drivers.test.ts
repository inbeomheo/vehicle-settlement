import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { testDatabase } from '../helpers/database';
import { factories, setupScenario } from '../helpers/factories';
import { callRoute } from '../helpers/routes';
import {
  createJoinLink,
  getJoinLinkStatus,
  listJoinLinks,
  registerDriver,
  revokeJoinLink,
} from '../../src/server/services/driver-join';
import {
  getDriverProfile,
  listDriverProfiles,
  updateDriverProfile,
} from '../../src/server/services/driver-profiles';
import { createInvite, acceptInvite, getInviteStatus } from '../../src/server/services/auth';
import { deleteProject, saveMaster, updateUser } from '../../src/server/services/admin';
import { createUse, getUse } from '../../src/server/services/uses';
import { todaySeoul } from '../../src/server/context';
import { driverJoinLinks, driverAffiliations, projects, users } from '../../src/server/db/schema';
import { POST as createLinkRoute } from '../../src/app/api/driver-join-links/route';
import { GET as profileRoute, PATCH as patchProfileRoute } from '../../src/app/api/driver-profile/route';
import { GET as directoryRoute } from '../../src/app/api/drivers/route';
import { PATCH as driverPatchRoute } from '../../src/app/api/drivers/[id]/route';

const database = testDatabase();
let serial = 0;
function registration(overrides: Record<string, unknown> = {}) {
  const n = String(++serial).padStart(4, '0');
  return {
    client_request_id: randomUUID(),
    login_id: `join-${randomUUID()}`,
    password: 'password1234',
    profile: {
      name: `가입 기사${n}`,
      phone: `0101234${n}`,
      business_name: `가입 운송${n}`,
      biz_no: `100-12-0${n}`,
      plate_no: `서울80아${n}`,
      vehicle_type: '카고',
      tonnage: '8',
      ...overrides,
    },
  };
}
const tokenOf = (url: string) => new URL(url).pathname.split('/').at(-1)!;
async function scenario() {
  const f = factories(database().db);
  const admin = await f.user();
  const project = await f.project();
  const ctx = f.context(admin);
  const link = await createJoinLink(ctx, { project_ids: [project.id] });
  return { f, admin, ctx, project, link, token: tokenOf(link.join_url) };
}

it('공용 링크로 여러 명 가입: 트랜잭션·배정·기본차량·사업자 재사용·멱등 재전송', async () => {
  const s = await scenario();
  const input = registration();
  const first = await registerDriver(database().db, randomUUID(), s.token, input);
  const user = (await database().db.select().from(users).where(eq(users.id, first.user.id)))[0];
  const info = await getDriverProfile(s.f.context(user), user.id);
  expect(info).toMatchObject({
    name: input.profile.name,
    phone: input.profile.phone,
    tonnage: '8.000',
    projects: [{ id: s.project.id }],
  });
  const secondInput = registration({
    biz_no: input.profile.biz_no.replaceAll('-', ''),
    business_name: '입력한 다른 상호',
  });
  const second = await registerDriver(database().db, randomUUID(), s.token, secondInput);
  expect((await getDriverProfile(s.ctx, second.user.id)).business_name).toBe(input.profile.business_name);
  const affiliations = await database()
    .db.select()
    .from(driverAffiliations)
    .where(sql`${driverAffiliations.driver_id} in (${user.driver_id}::uuid, ${second.user.driver_id}::uuid)`);
  expect(new Set(affiliations.map((a) => a.counterparty_id)).size).toBe(1);
  expect(affiliations.every((a) => a.valid_from === todaySeoul())).toBe(true);
  const replay = await registerDriver(database().db, randomUUID(), s.token, input);
  expect(replay.user.id).toBe(first.user.id);
  expect((await listJoinLinks(s.ctx)).find((row) => row.id === s.link.id)?.used_count).toBe(2);
  await expect(
    registerDriver(database().db, randomUUID(), s.token, { ...input, login_id: 'changed' }),
  ).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' });
});

it('기존 차량을 정규화해 재사용하고, 동시 가입의 전화·차량 중복은 하나만 저장한다', async () => {
  const s = await scenario();
  const input = registration();
  const vehicle = await s.f.vehicle({
    plate_no: input.profile.plate_no.replace('서울', '서울 '),
    tonnage: '3',
  });
  const first = await registerDriver(database().db, randomUUID(), s.token, input);
  const driver = await database().pool.query('SELECT default_vehicle_id FROM drivers WHERE id=$1', [
    first.user.driver_id,
  ]);
  expect(driver.rows[0].default_vehicle_id).toBe(vehicle.id);
  const samePhone = registration({ phone: input.profile.phone.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3') });
  await expect(registerDriver(database().db, randomUUID(), s.token, samePhone)).rejects.toThrow(
    '전화번호 또는 차량번호',
  );
  const samePlate = registration({ plate_no: input.profile.plate_no });
  await expect(registerDriver(database().db, randomUUID(), s.token, samePlate)).rejects.toThrow(
    '전화번호 또는 차량번호',
  );
  const racing = registration();
  const otherLink = await createJoinLink(s.ctx, { project_ids: [s.project.id] });
  const results = await Promise.allSettled([
    registerDriver(database().db, randomUUID(), s.token, racing),
    registerDriver(
      database().db,
      randomUUID(),
      tokenOf(otherLink.join_url),
      registration({ phone: racing.profile.phone }),
    ),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const before = (
    await database().pool.query(
      'SELECT (SELECT count(*) FROM users) u, (SELECT count(*) FROM counterparties) c, (SELECT count(*) FROM vehicles) v, (SELECT count(*) FROM drivers) d',
    )
  ).rows[0];
  await expect(
    registerDriver(database().db, randomUUID(), s.token, { ...registration(), login_id: input.login_id }),
  ).rejects.toThrow('아이디');
  expect(
    (
      await database().pool.query(
        'SELECT (SELECT count(*) FROM users) u, (SELECT count(*) FROM counterparties) c, (SELECT count(*) FROM vehicles) v, (SELECT count(*) FROM drivers) d',
      )
    ).rows[0],
  ).toEqual(before);
});

it('폐기·만료·현장 중지·권한 검사 및 토큰 원문 비저장', async () => {
  const s = await scenario();
  const outsider = await s.f.user({ role: 'SITE_MANAGER' });
  await expect(createJoinLink(s.f.context(outsider), { project_ids: [s.project.id] })).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  await expect(listJoinLinks(s.f.context(outsider))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(revokeJoinLink(s.f.context(outsider), s.link.id, { version: 1 })).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  await expect(revokeJoinLink(s.ctx, s.link.id, { version: 2 })).rejects.toMatchObject({
    code: 'VERSION_CONFLICT',
  });
  const acceptedInput = registration();
  await registerDriver(database().db, randomUUID(), s.token, acceptedInput);
  await revokeJoinLink(s.ctx, s.link.id, { version: 1 });
  expect(await getJoinLinkStatus(database().db, s.token)).toBeNull();
  await expect(registerDriver(database().db, randomUUID(), s.token, acceptedInput)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  const expired = await createJoinLink(s.ctx, { project_ids: [s.project.id] });
  await database()
    .db.update(driverJoinLinks)
    .set({ expires_at: new Date(0) })
    .where(eq(driverJoinLinks.id, expired.id));
  await expect(
    registerDriver(database().db, randomUUID(), tokenOf(expired.join_url), registration()),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  const inactive = await createJoinLink(s.ctx, { project_ids: [s.project.id] });
  await saveMaster(s.ctx, 'projects', { active: false }, s.project.id);
  await expect(
    registerDriver(database().db, randomUUID(), tokenOf(inactive.join_url), registration()),
  ).rejects.toThrow('현장');
  const session = await s.f.session(s.admin.id);
  const p = await s.f.project();
  const options = {
    method: 'POST',
    path: '/api/driver-join-links',
    token: session.token,
    headers: { 'idempotency-key': randomUUID() },
    body: { project_ids: [p.id] },
  };
  const response = await callRoute(database().db, createLinkRoute, options);
  expect(response.status).toBe(200);
  const token = tokenOf((await response.json()).data.join_url);
  const replay = await callRoute(database().db, createLinkRoute, options);
  expect((await replay.json()).data.join_url).toBeUndefined();
  for (const { tablename } of (
    await database().pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")
  ).rows) {
    const rows = await database().pool.query(
      `SELECT 1 FROM "${tablename.replaceAll('"', '""')}" t WHERE strpos(row_to_json(t)::text, $1)>0`,
      [token],
    );
    expect(rows.rows, tablename).toHaveLength(0);
  }
});

it('기사 연결 없는 개별 초대도 정보 입력 후 한 번만 가입하며 기존 초대 수락은 유지한다', async () => {
  const s = await scenario();
  const invite = await createInvite(s.ctx, {
    role: 'DRIVER',
    name: '초대 기사',
    project_ids: [s.project.id],
  });
  const token = tokenOf(invite.invite_url);
  expect(await getInviteStatus(database().db, token)).toMatchObject({ needs_profile: true });
  const input = registration();
  await expect(
    acceptInvite(database().db, randomUUID(), token, { login_id: input.login_id, password: input.password }),
  ).rejects.toThrow('기사 가입 화면');
  const accepted = await registerDriver(database().db, randomUUID(), token, input, true);
  expect((await registerDriver(database().db, randomUUID(), token, input, true)).user.id).toBe(
    accepted.user.id,
  );
  await expect(
    registerDriver(database().db, randomUUID(), token, registration(), true),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  const oldDriver = await s.f.driver();
  const old = await createInvite(s.ctx, { role: 'DRIVER', name: '기존', driver_id: oldDriver.id });
  expect(
    (
      await acceptInvite(database().db, randomUUID(), tokenOf(old.invite_url), {
        login_id: randomUUID(),
        password: 'password1234',
      })
    ).user.driver_id,
  ).toBe(oldDriver.id);
});

it('현장 담당자는 현재 교집합 현장 기사만 읽고, 정산 담당자는 전체 조회, 기사 본인은 전화까지 읽는다', async () => {
  const s = await scenario();
  const otherProject = await s.f.project();
  const link = await createJoinLink(s.ctx, { project_ids: [s.project.id, otherProject.id] });
  const input = registration();
  const registered = await registerDriver(database().db, randomUUID(), tokenOf(link.join_url), input);
  const manager = await s.f.user({ role: 'SITE_MANAGER' });
  const managerCtx = s.f.context(manager);
  expect(await listDriverProfiles(managerCtx)).toEqual([]);
  const assignment = await s.f.assignment(manager.id, s.project.id);
  const rows = await listDriverProfiles(managerCtx);
  expect(rows).toHaveLength(1);
  expect(rows[0].projects).toEqual([{ id: s.project.id, name: s.project.name }]);
  await expect(
    updateDriverProfile(managerCtx, registered.user.id, { ...input.profile, version: 1 }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const settlement = await s.f.user({ role: 'SETTLEMENT_MANAGER', all_projects: false });
  expect((await listDriverProfiles(s.f.context(settlement))).some((r) => r.id === registered.user.id)).toBe(
    true,
  );
  await database().pool.query('UPDATE project_assignments SET revoked_at=now() WHERE id=$1', [assignment.id]);
  await expect(getDriverProfile(managerCtx, registered.user.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  const own = await callRoute(database().db, profileRoute, { token: registered.token });
  expect((await own.json()).data.phone).toBe(input.profile.phone);
  const denied = await callRoute(database().db, directoryRoute, { token: registered.token });
  expect(denied.status).toBe(403);
  const forbiddenPatch = await callRoute(database().db, driverPatchRoute, {
    method: 'PATCH',
    token: registered.token,
    params: { id: s.admin.id },
    body: { ...input.profile, version: 1 },
  });
  expect(forbiddenPatch.status).toBe(403);
  const changed = await callRoute(database().db, patchProfileRoute, {
    method: 'PATCH',
    token: registered.token,
    body: { ...input.profile, version: 1, name: '본인 변경' },
  });
  expect(changed.status).toBe(200);
  expect((await changed.json()).data.version).toBe(2);
  await updateUser(s.ctx, registered.user.id, { status: 'DISABLED', version: 2 });
  expect((await callRoute(database().db, profileRoute, { token: registered.token })).status).toBe(401);
});

it('정보 변경은 오늘 새 소속·새 차량에 적용하고 과거 운행 스냅샷 보존, 버전 경합과 실패는 롤백', async () => {
  const s = await setupScenario(database().db);
  const use = await createUse(s.driverCtx, s.input);
  const before = structuredClone(use.snapshot);
  const input = registration().profile;
  const changed = await updateDriverProfile(s.driverCtx, s.driverUser.id, { ...input, version: 1 });
  expect(changed).toMatchObject({ ...input, tonnage: '8.000', version: 2 });
  expect((await getUse(s.driverCtx, use.id)).snapshot).toEqual(before);
  const old = (
    await database().db.select().from(driverAffiliations).where(eq(driverAffiliations.id, s.affiliation.id))
  )[0];
  expect(old.valid_to).not.toBeNull();
  expect(old.valid_to! < todaySeoul()).toBe(true);
  const newBusiness = registration().profile;
  await updateDriverProfile(s.adminCtx, s.driverUser.id, { ...newBusiness, version: 2 });
  const current = await database()
    .db.select()
    .from(driverAffiliations)
    .where(sql`${driverAffiliations.driver_id}=${s.driver.id}::uuid AND valid_from=${todaySeoul()}::date`);
  expect(current).toHaveLength(1);
  const outcomes = await Promise.allSettled([
    updateDriverProfile(s.adminCtx, s.driverUser.id, { ...newBusiness, name: '수정 하나', version: 3 }),
    updateDriverProfile(s.adminCtx, s.driverUser.id, { ...newBusiness, name: '수정 둘', version: 3 }),
  ]);
  expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const conflicting = await s.f.driver({ phone: '01099998888' });
  await expect(
    updateDriverProfile(s.adminCtx, s.driverUser.id, {
      ...newBusiness,
      phone: conflicting.phone,
      version: 4,
    }),
  ).rejects.toThrow('전화번호');
  expect((await getDriverProfile(s.adminCtx, s.driverUser.id)).version).toBe(4);
  await expect(
    updateDriverProfile(s.driverCtx, s.admin.id, { ...newBusiness, version: 1 }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

it('현장 코드 자동 생성·고유성·빈 코드 수정 유지, 연결 없는 현장 삭제만 허용', async () => {
  const s = await scenario();
  const first = await saveMaster(s.ctx, 'projects', { name: '탕정', evidence_policy: 'NONE' });
  const second = await saveMaster(s.ctx, 'projects', { name: '용인', code: '', evidence_policy: 'NONE' });
  expect(first.code).not.toBe(second.code);
  expect((await saveMaster(s.ctx, 'projects', { code: '', name: '새 이름' }, String(first.id))).code).toBe(
    first.code,
  );
  await deleteProject(s.ctx, String(first.id));
  expect(
    await database()
      .db.select()
      .from(projects)
      .where(eq(projects.id, String(first.id))),
  ).toHaveLength(0);
  await expect(deleteProject(s.ctx, s.project.id)).rejects.toThrow('사용 중지');
  const payee = await s.f.counterparty();
  await s.f.rate(payee.id, { project_id: String(second.id) });
  await expect(deleteProject(s.ctx, String(second.id))).rejects.toThrow('사용 중지');
  const useScenario = await setupScenario(database().db);
  await createUse(useScenario.driverCtx, useScenario.input);
  await expect(deleteProject(s.ctx, useScenario.project.id)).rejects.toThrow('사용 중지');
  await expect(deleteProject(useScenario.driverCtx, String(second.id))).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  const duplicate = await callRoute(
    database().db,
    (await import('../../src/app/api/admin/[resource]/route')).POST,
    {
      method: 'POST',
      token: (await s.f.session(s.admin.id)).token,
      params: { resource: 'projects' },
      body: { code: second.code, name: '중복', evidence_policy: 'NONE' },
    },
  );
  expect(duplicate.status).toBe(422);
});

it('후속 사용자 저장 실패 시 거래처·차량·기사·소속 전체를 롤백한다', async () => {
  const s = await scenario();
  const input = { ...registration(), login_id: 'join-rollback' };
  const counts = async () =>
    (
      await database().pool.query(
        'SELECT (SELECT count(*) FROM users) u, (SELECT count(*) FROM counterparties) c, (SELECT count(*) FROM vehicles) v, (SELECT count(*) FROM drivers) d, (SELECT count(*) FROM driver_affiliations) a, (SELECT count(*) FROM driver_registrations) r',
      )
    ).rows[0];
  const before = await counts();
  await database().pool.query(
    `CREATE FUNCTION join_fail_user() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.login_id='join-rollback' THEN RAISE EXCEPTION '가입 저장 실패'; END IF; RETURN NEW; END $$; CREATE TRIGGER join_fail_user BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION join_fail_user()`,
  );
  try {
    await expect(registerDriver(database().db, randomUUID(), s.token, input)).rejects.toThrow();
  } finally {
    await database().pool.query('DROP TRIGGER join_fail_user ON users; DROP FUNCTION join_fail_user()');
  }
  expect(await counts()).toEqual(before);
  const results = await Promise.all([
    registerDriver(database().db, randomUUID(), s.token, input),
    registerDriver(database().db, randomUUID(), s.token, input),
  ]);
  expect(results[0].user.id).toBe(results[1].user.id);
  expect((await listJoinLinks(s.ctx)).find((row) => row.id === s.link.id)?.used_count).toBe(1);
});

it('사업자·전화·톤수·비밀번호 입력 검증과 공유 사업자 상호 보호', async () => {
  const s = await scenario();
  for (const profile of [{ biz_no: '123' }, { phone: 'hello' }, { tonnage: '0' }, { tonnage: '1.0001' }]) {
    await expect(
      registerDriver(database().db, randomUUID(), s.token, registration(profile)),
    ).rejects.toThrow();
  }
  await expect(
    registerDriver(database().db, randomUUID(), s.token, { ...registration(), password: 'short' }),
  ).rejects.toThrow();
  await expect(
    registerDriver(database().db, randomUUID(), s.token, { ...registration(), password: '가'.repeat(25) }),
  ).rejects.toThrow();
  const input = registration();
  const first = await registerDriver(database().db, randomUUID(), s.token, input);
  await registerDriver(database().db, randomUUID(), s.token, registration({ biz_no: input.profile.biz_no }));
  await expect(
    updateDriverProfile(s.ctx, first.user.id, {
      ...input.profile,
      business_name: '공유 상호 변경',
      version: 1,
    }),
  ).rejects.toThrow('여러 기사');
  expect((await getDriverProfile(s.ctx, first.user.id)).business_name).toBe(input.profile.business_name);
  await updateDriverProfile(s.ctx, first.user.id, {
    ...input.profile,
    biz_no: '999-99-99999',
    business_name: '별도 사업자',
    version: 1,
  });
  expect((await getDriverProfile(s.ctx, first.user.id)).business_name).toBe('별도 사업자');
});

it('가입 HTTP의 잘못된 톤수는 422이고, 본인 수정 멱등 재생은 버전을 다시 올리지 않는다', async () => {
  const s = await scenario();
  const route = (await import('../../src/app/api/join/[token]/route')).POST;
  for (const tonnage of ['문자', '', 'NaN', 'Infinity', '-1']) {
    const response = await callRoute(database().db, route, {
      method: 'POST',
      params: { token: s.token },
      body: registration({ tonnage }),
    });
    expect(response.status).toBe(422);
  }
  const input = registration();
  const joined = await registerDriver(database().db, randomUUID(), s.token, input);
  const options = {
    method: 'PATCH',
    path: '/api/driver-profile',
    token: joined.token,
    headers: { 'idempotency-key': randomUUID() },
    body: { ...input.profile, name: '멱등 정보 변경', version: 1 },
  };
  const first = await callRoute(database().db, patchProfileRoute, options);
  expect(first.status).toBe(200);
  const again = await callRoute(database().db, patchProfileRoute, options);
  expect(again.headers.get('idempotency-replayed')).toBe('true');
  expect((await again.json()).data).toEqual({ id: joined.user.id, version: 2 });
  expect((await getDriverProfile(s.ctx, joined.user.id)).version).toBe(2);
});
