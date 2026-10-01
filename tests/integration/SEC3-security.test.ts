import { randomUUID } from 'node:crypto';
import { it, expect } from 'vitest';
import { testDatabase } from '../helpers/database';
import { factories, setupScenario } from '../helpers/factories';
import { withDatabase } from '@/server/db/client';
import { todaySeoul } from '@/server/context';
import { POST as usePost } from '@/app/api/uses/route';
import { PATCH as profilePatch } from '@/app/api/driver-profile/route';
import { GET as rateGet } from '@/app/api/rates/lookup/route';
import { POST as acceptPost } from '@/app/api/invites/[id]/accept/route';
import { getLookups } from '@/server/services/lookups';
import { getDriverProfile, updateDriverProfile } from '@/server/services/driver-profiles';
import { acceptInvite, createInvite } from '@/server/services/auth';
import { createJoinLink, registerDriver, getJoinLinkStatus } from '@/server/services/driver-join';
import { saveMaster, addAssignment, revokeAssignment } from '@/server/services/admin';
import { createUse, submitUse, approveUse, updateUse } from '@/server/services/uses';
import { getSummary } from '@/server/services/summary';
import { driverSettlements } from '@/server/services/statements-driver';
import { lookupRate } from '@/server/services/rates';
import type { RouteHandler } from '@/server/http';
const database = testDatabase();
async function request(
  handler: RouteHandler,
  path: string,
  token?: string,
  body?: unknown,
  method = body ? 'POST' : 'GET',
  params = {},
) {
  return withDatabase(database().db, () =>
    handler(
      new Request('http://localhost:3198' + path, {
        method,
        headers: { ...(token ? { cookie: `sid=${token}` } : {}), 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      { params: Promise.resolve(params) },
    ),
  );
}
function fields(p: Awaited<ReturnType<typeof getDriverProfile>>) {
  return {
    version: p.version,
    name: p.name,
    phone: p.phone,
    business_name: p.business_name,
    biz_no: p.biz_no,
    plate_no: p.plate_no,
    vehicle_type: p.vehicle_type,
    tonnage: p.tonnage,
  };
}
it('SEC3-01 타인 차량 ID를 운행에 넣어 피해 기사 차량 수정 권한을 잠글 수 없어야 한다', async () => {
  const s = await setupScenario(database().db);
  await database().pool.query('UPDATE counterparties SET biz_no=$1 WHERE id=$2', [
    '333-22-11111',
    s.payee.id,
  ]);
  const victimVehicle = await s.f.vehicle({ plate_no: '서울99가4312', vehicle_type: '덤프', tonnage: '25' });
  const victim = await s.f.driver({ phone: '01099996666', default_vehicle_id: victimVehicle.id });
  const victimParty = await s.f.counterparty({ biz_no: '777-11-43210' });
  await s.f.affiliation(victim.id, victimParty.id);
  const victimUser = await s.f.user({ role: 'DRIVER', driver_id: victim.id });
  const victimToken = (await s.f.session(victimUser.id)).token;
  const attackerToken = (await s.f.session(s.driverUser.id)).token;
  const before = await getDriverProfile(s.adminCtx, victimUser.id);
  // Baseline: this is the victim's exclusive vehicle, so changing its specification succeeds.
  const baseline = await request(
    profilePatch,
    '/api/driver-profile',
    victimToken,
    { ...fields(before), tonnage: '24' },
    'PATCH',
  );
  expect(baseline.status).toBe(200);
  expect((await getLookups(s.driverCtx)).vehicles.map((v) => v.id)).not.toContain(victimVehicle.id);
  const forged = await request(usePost, '/api/uses', attackerToken, {
    ...s.input,
    vehicle_id: victimVehicle.id,
  });
  const payload = await forged.json();
  const after = await getDriverProfile(s.adminCtx, victimUser.id);
  const victimEdit = await request(
    profilePatch,
    '/api/driver-profile',
    victimToken,
    { ...fields(after), tonnage: '25' },
    'PATCH',
  );
  expect(payload).not.toHaveProperty('data');
  expect((await getLookups(s.driverCtx)).vehicles.map((v) => v.id)).not.toContain(victimVehicle.id);
  expect(
    (
      await database().pool.query('SELECT id FROM vehicle_uses WHERE driver_id=$1 AND vehicle_id=$2', [
        s.driver.id,
        victimVehicle.id,
      ])
    ).rows,
  ).toHaveLength(0);
  expect(forged.status, '기사 선택 범위 밖 차량을 운행에 연결했다').toBe(404);
  expect(victimEdit.status).toBe(200);
});
it('SEC3-02 현장 담당자가 선택 범위 밖 고객의 전현장 계약을 직접 조회할 수 없어야 한다', async () => {
  const s = await setupScenario(database().db);
  const manager = await s.f.user({ role: 'SITE_MANAGER' });
  await s.f.assignment(manager.id, s.project.id);
  const customer = await s.f.counterparty({ kind: 'CUSTOMER', name: '외부 원청' });
  await s.f.rate(customer.id, {
    direction: 'RECEIVABLE',
    project_id: null,
    unit_price: 987654,
    notes: '외부 원청 비공개 계약 메모',
  });
  const priorProject = await s.f.project();
  const oldAssignment = await s.f.assignment(manager.id, priorProject.id);
  await createUse(s.adminCtx, {
    ...s.input,
    project_id: priorProject.id,
    customer_counterparty_id: customer.id,
  });
  expect((await getLookups(s.f.context(manager))).counterparties.map((p) => p.id)).toContain(customer.id);
  await revokeAssignment(s.adminCtx, oldAssignment.id);
  expect((await getLookups(s.f.context(manager))).counterparties.map((p) => p.id)).not.toContain(customer.id);
  const managerToken = (await s.f.session(manager.id)).token;
  const deniedCreate = await request(usePost, '/api/uses', managerToken, {
    ...s.input,
    customer_counterparty_id: customer.id,
  });
  expect(deniedCreate.status).toBe(404);
  const query = new URLSearchParams({
    project_id: s.project.id,
    counterparty_id: customer.id,
    vehicle_id: s.vehicle.id,
    direction: 'RECEIVABLE',
    use_date: todaySeoul(),
  });
  const response = await request(rateGet, '/api/rates/lookup?' + query, managerToken);
  const body = await response.json();
  expect(body).not.toHaveProperty('data');
  expect(JSON.stringify(body)).not.toContain('외부 원청 비공개 계약 메모');
  expect(response.status, '목록에서 제외된 거래처의 단가와 notes가 반환되었다').toBe(404);
});
it('SEC3-03 개별 초대 수락 시 유일한 현장이 사용 중지됐으면 가입을 막아야 한다', async () => {
  const f = factories(database().db);
  const admin = f.context(await f.user());
  const project = await f.project();
  const driver = await f.driver();
  const invite = await createInvite(admin, {
    role: 'DRIVER',
    name: '초대 기사',
    driver_id: driver.id,
    project_ids: [project.id],
  });
  await saveMaster(admin, 'projects', { active: false }, project.id);
  const token = invite.invite_url.split('/').at(-1)!;
  const response = await request(
    acceptPost,
    '/api/invites/' + token + '/accept',
    undefined,
    { login_id: randomUUID(), password: 'new-password123' },
    'POST',
    { id: token },
  );
  const body = await response.json();
  expect(body.error.message).toBe(
    '초대한 현장이 지금 사용 중지 상태예요. 관리자에게 새 초대를 요청해 주세요.',
  );
  expect(response.headers.get('set-cookie')).toBeNull();
  expect(response.status, '현장이 하나도 없는 활성 기사 계정과 세션이 발급됨').toBe(422);
});
it('SEC3-FLOW 관리자를 시작으로 새 현장·공용 가입·운행·담당자 승인·현장 집계까지 정상 연결된다', async () => {
  const f = factories(database().db);
  const admin = f.context(await f.user());
  const project = await saveMaster(admin, 'projects', {
    name: '첫사용 현장',
    evidence_policy: 'NONE',
    assign_all_drivers: true,
  });
  const manager = await f.user({ role: 'SITE_MANAGER' });
  await addAssignment(admin, { user_id: manager.id, project_id: project.id, valid_from: todaySeoul() });
  const link = await createJoinLink(admin, { project_ids: [project.id] });
  const joined = await registerDriver(database().db, randomUUID(), link.join_url.split('/').at(-1)!, {
    client_request_id: randomUUID(),
    login_id: randomUUID(),
    password: 'first-password123',
    profile: {
      name: '첫 기사',
      phone: '01088887777',
      business_name: '첫 상호',
      biz_no: '600-21-99991',
      plate_no: '서울88가1234',
      vehicle_type: '카고',
      tonnage: '1',
    },
  });
  const user = (await database().pool.query('SELECT * FROM users WHERE id=$1', [joined.user.id])).rows[0];
  const ctx = f.context(user);
  const opts = await getLookups(ctx);
  expect(opts.projects.map((p) => p.id)).toEqual([project.id]);
  let use = await createUse(ctx, {
    project_id: project.id as string,
    use_date: todaySeoul(),
    reviewer_user_id: manager.id,
    load_tonnage: '1',
    driver_id: user.driver_id,
    vehicle_id: opts.vehicles[0].id,
    trips: [{ seq: 1, origin: '상차', destination: '하차' }],
    charge_lines: [
      {
        direction: 'PAYABLE',
        charge_type: 'BASE',
        billing_unit: 'PER_DAY',
        quantity: '1',
        requested_amount: 345678,
      },
    ],
  });
  expect(use.charge_lines[0].approved_amount).toBeNull();
  use = await submitUse(ctx, use.id, { version: use.version });
  use = await approveUse(f.context(manager), use.id, { version: use.version });
  const summary = await getSummary(f.context(manager), { from: todaySeoul(), to: todaySeoul() });
  expect(summary.totals.approved_supply).toBe(345678);
  const own = await driverSettlements(ctx, { periodStart: todaySeoul(), periodEnd: todaySeoul() });
  expect(own.uses.find((u) => u.id === use.id)?.approved_supply).toBe(345678);
});

it('SEC3-02 고객은 요청 현장에 연결되어야 하며 활성 기사 지급처와 관리자 조회는 유지한다', async () => {
  const s = await setupScenario(database().db);
  const manager = await s.f.user({ role: 'SITE_MANAGER' });
  await s.f.assignment(manager.id, s.project.id);
  const other = await s.f.project();
  await s.f.assignment(manager.id, other.id);
  const customer = await s.f.counterparty({ kind: 'CUSTOMER' });
  await s.f.rate(customer.id, { direction: 'RECEIVABLE', notes: '비공개 메모' });
  await createUse(s.adminCtx, { ...s.input, project_id: other.id, customer_counterparty_id: customer.id });
  const q = { ...s.input, counterparty_id: customer.id, direction: 'RECEIVABLE' };
  await expect(lookupRate(s.f.context(manager), q)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(
    createUse(s.f.context(manager), { ...s.input, customer_counterparty_id: customer.id }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect((await lookupRate(s.f.context(manager), { ...q, project_id: other.id })).rate?.notes).toBe(
    '비공개 메모',
  );
  expect((await lookupRate(s.adminCtx, q)).rate?.notes).toBe('비공개 메모');
  const payeeQuery = { ...q, direction: 'PAYABLE', counterparty_id: s.payee.id };
  expect((await lookupRate(s.f.context(manager), payeeQuery)).rate?.id).toBe(s.rate.id);
  expect((await lookupRate(s.driverCtx, payeeQuery)).rate?.id).toBe(s.rate.id);
  await expect(lookupRate(s.driverCtx, q)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  const unrelated = await s.f.counterparty();
  await s.f.rate(unrelated.id);
  for (const ctx of [s.driverCtx, s.f.context(manager)])
    await expect(lookupRate(ctx, { ...payeeQuery, counterparty_id: unrelated.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
});

it.each(['DRAFT', 'SUBMITTED', 'NEEDS_FIX', 'APPROVED', 'PROXY'] as const)(
  'SEC3-01 %s 이력의 차량 선택·생성·변경과 차량 보호는 신뢰된 운행만 근거로 한다',
  async (status) => {
    const s = await setupScenario(database().db);
    await database().pool.query('UPDATE counterparties SET biz_no=$1 WHERE id=$2', [
      '882-11-99999',
      s.payee.id,
    ]);
    const vehicle = await s.f.vehicle();
    // Seed an old record directly: pre-fix driver drafts could reference arbitrary vehicles.
    const old = await createUse(s.adminCtx, { ...s.input, vehicle_id: vehicle.id });
    await database().pool.query(
      'UPDATE vehicle_uses SET entered_as=$1, created_by_user_id=$2, review_status=$3 WHERE id=$4',
      [
        status === 'PROXY' ? 'PROXY' : 'DRIVER_SELF',
        status === 'PROXY' ? s.admin.id : s.driverUser.id,
        status === 'PROXY' ? 'DRAFT' : status,
        old.id,
      ],
    );
    const own = await createUse(s.driverCtx, s.input);
    const trusted = status === 'APPROVED' || status === 'PROXY';
    expect((await getLookups(s.driverCtx)).vehicles.some((v) => v.id === vehicle.id)).toBe(trusted);
    if (trusted) {
      expect((await createUse(s.driverCtx, { ...s.input, vehicle_id: vehicle.id })).vehicle_id).toBe(
        vehicle.id,
      );
      expect(
        (await updateUse(s.driverCtx, own.id, { version: own.version, vehicle_id: vehicle.id })).vehicle_id,
      ).toBe(vehicle.id);
    } else {
      await expect(createUse(s.driverCtx, { ...s.input, vehicle_id: vehicle.id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(
        updateUse(s.driverCtx, own.id, { version: own.version, vehicle_id: vehicle.id }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    const owner = await s.f.driver({
      phone: `0105544000${['DRAFT', 'SUBMITTED', 'NEEDS_FIX', 'APPROVED', 'PROXY'].indexOf(status)}`,
      default_vehicle_id: vehicle.id,
    });
    const ownerUser = await s.f.user({ role: 'DRIVER', driver_id: owner.id });
    await s.f.affiliation(owner.id, s.payee.id);
    const profile = await getDriverProfile(s.adminCtx, ownerUser.id);
    const edit = updateDriverProfile(s.f.context(ownerUser), ownerUser.id, {
      ...fields(profile),
      tonnage: '25',
    });
    if (trusted) await expect(edit).rejects.toThrow('이미 다른 기사님 차량');
    else expect((await edit).tonnage).toBe('25.000');
    // Even trusted history cannot override another active driver's current default.
    expect((await getLookups(s.driverCtx)).vehicles.map((v) => v.id)).not.toContain(vehicle.id);
    await expect(createUse(s.driverCtx, { ...s.input, vehicle_id: vehicle.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  },
);

it('SEC3-01 기본차량을 공유하는 활성 기사가 있으면 본인 기본차량이어도 새 운행을 차단하고 담당자 대리는 허용한다', async () => {
  const s = await setupScenario(database().db);
  await s.f.driver({ default_vehicle_id: s.vehicle.id });
  await expect(createUse(s.driverCtx, s.input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect((await createUse(s.adminCtx, s.input)).entered_as).toBe('PROXY');
});

it('SEC3-03 연결형 초대는 일부 중지 시 활성 현장만 배정하고 전부 중지 시 초대·계정·세션을 보존한다', async () => {
  const s = await setupScenario(database().db);
  const stopped = await s.f.project();
  const driver = await s.f.driver();
  const invite = await createInvite(s.adminCtx, {
    role: 'DRIVER',
    name: '초대 기사',
    driver_id: driver.id,
    project_ids: [s.project.id, stopped.id],
  });
  const token = invite.invite_url.split('/').at(-1)!;
  await saveMaster(s.adminCtx, 'projects', { active: false }, stopped.id);
  await saveMaster(s.adminCtx, 'projects', { active: false }, s.project.id);
  const input = { login_id: randomUUID(), password: 'password1234' };
  await expect(acceptInvite(database().db, randomUUID(), token, input)).rejects.toThrow(
    '초대한 현장이 지금 사용 중지 상태예요. 관리자에게 새 초대를 요청해 주세요.',
  );
  expect(
    (await database().pool.query('SELECT id FROM users WHERE login_id=$1', [input.login_id])).rows,
  ).toHaveLength(0);
  expect(
    (await database().pool.query('SELECT used_at,used_by_user_id FROM invites WHERE id=$1', [invite.id]))
      .rows[0],
  ).toEqual({ used_at: null, used_by_user_id: null });
  await saveMaster(s.adminCtx, 'projects', { active: true }, s.project.id);
  const accepted = await acceptInvite(database().db, randomUUID(), token, input);
  expect(
    (
      await database().pool.query('SELECT project_id FROM project_assignments WHERE user_id=$1', [
        accepted.user.id,
      ])
    ).rows,
  ).toEqual([{ project_id: s.project.id }]);
});

it.each([false, true])(
  'SEC3-03 직접 가입(개별 초대=%s)도 활성 현장만 배정하고 0개이면 원자적으로 거부한다',
  async (individual) => {
    const s = await setupScenario(database().db);
    const stopped = await s.f.project();
    const project_ids = [s.project.id, stopped.id];
    const source = individual
      ? await createInvite(s.adminCtx, { role: 'DRIVER', name: '직접 가입', project_ids })
      : await createJoinLink(s.adminCtx, { project_ids });
    const token = ('invite_url' in source ? source.invite_url : source.join_url).split('/').at(-1)!;
    const suffix = individual ? '5511' : '5522';
    const input = {
      client_request_id: randomUUID(),
      login_id: randomUUID(),
      password: 'password1234',
      profile: {
        name: '직접 가입',
        phone: `0104444${suffix}`,
        business_name: '직접 사업자',
        biz_no: `882330${suffix}`,
        plate_no: `서울88아${suffix}`,
        vehicle_type: '카고',
        tonnage: '1',
      },
    };
    await saveMaster(s.adminCtx, 'projects', { active: false }, stopped.id);
    await saveMaster(s.adminCtx, 'projects', { active: false }, s.project.id);
    if (!individual) expect(await getJoinLinkStatus(database().db, token)).toBeNull();
    await expect(registerDriver(database().db, randomUUID(), token, input, individual)).rejects.toThrow(
      '초대한 현장이 지금 사용 중지 상태예요. 관리자에게 새 초대를 요청해 주세요.',
    );
    expect(
      (await database().pool.query('SELECT id FROM users WHERE login_id=$1', [input.login_id])).rows,
    ).toHaveLength(0);
    expect(
      (
        await database().pool.query('SELECT id FROM driver_registrations WHERE client_request_id=$1', [
          input.client_request_id,
        ])
      ).rows,
    ).toHaveLength(0);
    await saveMaster(s.adminCtx, 'projects', { active: true }, s.project.id);
    if (!individual)
      expect(await getJoinLinkStatus(database().db, token)).toEqual({ project_names: [s.project.name] });
    const accepted = await registerDriver(database().db, randomUUID(), token, input, individual);
    expect(
      (
        await database().pool.query('SELECT project_id FROM project_assignments WHERE user_id=$1', [
          accepted.user.id,
        ])
      ).rows,
    ).toEqual([{ project_id: s.project.id }]);
  },
);
