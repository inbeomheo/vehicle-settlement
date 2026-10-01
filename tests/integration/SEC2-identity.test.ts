import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { withDatabase } from '@/server/db/client';
import type { RouteHandler } from '@/server/http';
import { todaySeoul } from '@/server/context';
import { POST as create } from '@/app/api/uses/route';
import { GET as detail, PATCH as patchUse } from '@/app/api/uses/[id]/route';
import { GET as options } from '@/app/api/lookups/route';
import { PATCH as profile } from '@/app/api/driver-profile/route';
import { createUse, getUse, submitUse } from '@/server/services/uses';
import { createJoinLink, registerDriver } from '@/server/services/driver-join';
import { getDriverProfile, updateDriverProfile } from '@/server/services/driver-profiles';

const database = testDatabase();
const vehicleMessage = '이미 다른 기사님 차량으로 등록된 번호예요. 관리자에게 문의해 주세요.';
async function request(
  handler: RouteHandler,
  token: string,
  body?: unknown,
  method = body ? 'POST' : 'GET',
  id?: string,
  key?: string,
) {
  return withDatabase(database().db, () =>
    handler(
      new Request(`http://localhost:3192/api/uses${id ? `/${id}` : ''}`, {
        method,
        headers: {
          cookie: `sid=${token}`,
          'content-type': 'application/json',
          ...(key ? { 'idempotency-key': key } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      { params: Promise.resolve<Record<string, string>>(id ? { id } : {}) },
    ),
  );
}
function fields(row: Awaited<ReturnType<typeof getDriverProfile>>) {
  return {
    version: row.version,
    name: row.name,
    phone: row.phone,
    business_name: row.business_name,
    biz_no: row.biz_no,
    plate_no: row.plate_no,
    vehicle_type: row.vehicle_type,
    tonnage: row.tonnage,
  };
}

it('SEC2-01 다른 현장 활성 기사 선택·연락·계약 적용은 허용하고 생성·조회·제출본·재생의 사업자·계좌는 숨긴다', async () => {
  const s = await setupScenario(database().db);
  const manager = await s.f.user({ role: 'SITE_MANAGER' });
  const otherProject = await s.f.project();
  await s.f.assignment(manager.id, s.project.id);
  const vehicle = await s.f.vehicle();
  const driver = await s.f.driver({ phone: '01077776666', default_vehicle_id: vehicle.id });
  const party = await s.f.counterparty({ biz_no: '778-81-12345', bank_account: '비공개계좌-123' });
  await s.f.affiliation(driver.id, party.id);
  await s.f.rate(party.id, { unit_price: 876543 });
  const user = await s.f.user({ role: 'DRIVER', driver_id: driver.id });
  await s.f.assignment(user.id, otherProject.id);
  const { token } = await s.f.session(manager.id);
  const lookups = (await (await request(options, token)).json()).data;
  expect(lookups.drivers).toContainEqual(expect.objectContaining({ id: driver.id }));
  const input = { ...s.input, driver_id: driver.id, client_request_id: randomUUID() };
  const key = randomUUID();
  const response = await request(create, token, input, 'POST', undefined, key);
  expect(response.status).toBe(200);
  const created = (await response.json()).data;
  expect(created.snapshot.driver_phone).toBe(driver.phone);
  expect(created.charge_lines[0].unit_price).toBe(876543);
  expect(created.snapshot).not.toHaveProperty('payee_biz_no');
  const submitted = await submitUse(s.adminCtx, created.id, { version: created.version });
  // Legacy snapshots and cached responses can contain nested financial identity.
  const sensitive = { biz_no: party.biz_no, bank_account: party.bank_account };
  await database().pool.query(
    'UPDATE use_revisions SET snapshot=snapshot || $1::jsonb WHERE vehicle_use_id=$2',
    [JSON.stringify({ payee: sensitive }), created.id],
  );
  await database().pool.query(
    'UPDATE idempotency_keys SET response_body=jsonb_set(response_body, $1, $2::jsonb) WHERE key=$3',
    ['{data,snapshot,payee}', JSON.stringify(sensitive), key],
  );
  for (const result of [
    await getUse(s.f.context(manager), created.id),
    (await (await request(detail, token, undefined, 'GET', created.id)).json()).data,
    (await (await request(create, token, input, 'POST', undefined, key)).json()).data,
    (
      await (
        await request(
          patchUse,
          token,
          { version: submitted.version, notes: '현장 확인' },
          'PATCH',
          created.id,
        )
      ).json()
    ).data,
  ]) {
    expect(JSON.stringify(result)).not.toMatch(/"(?:payee_biz_no|biz_no|bank_account)":/);
    expect(result.snapshot.driver_phone).toBe(driver.phone);
  }
  const admin = await getUse(s.adminCtx, submitted.id);
  expect(admin.snapshot.payee_biz_no).toBe(party.biz_no);
  expect(JSON.stringify(admin.revisions)).toContain(party.bank_account);
});

it.each(['driver', 'vehicle'] as const)('SEC2-01 비활성 %s로 새 운행을 만들 수 없다', async (kind) => {
  const s = await setupScenario(database().db);
  const manager = await s.f.user({ role: 'SITE_MANAGER' });
  await s.f.assignment(manager.id, s.project.id);
  if (kind === 'driver')
    await database().pool.query('UPDATE drivers SET active=false WHERE id=$1', [s.driver.id]);
  else await database().pool.query('UPDATE vehicles SET active=false WHERE id=$1', [s.vehicle.id]);
  const response = await request(create, (await s.f.session(manager.id)).token, s.input);
  expect(response.status).toBe(422);
  expect(
    (await database().pool.query('SELECT id FROM vehicle_uses WHERE driver_id=$1', [s.driver.id])).rows,
  ).toHaveLength(0);
});

it.each(['inactive', 'active', 'history'] as const)(
  'SEC2-02 가입 후 %s 타인 차량으로 변경하면 원장·연결·버전을 보존하며 거부한다',
  async (kind) => {
    const s = await setupScenario(database().db);
    const vehicle = await s.f.vehicle({ vehicle_type: '덤프', tonnage: '25' });
    const victim = await s.f.driver({ active: kind !== 'inactive', default_vehicle_id: vehicle.id });
    if (kind === 'history') {
      await s.f.affiliation(victim.id, s.payee.id);
      await createUse(s.adminCtx, { ...s.input, driver_id: victim.id, vehicle_id: vehicle.id });
      await database().pool.query('UPDATE drivers SET default_vehicle_id=NULL WHERE id=$1', [victim.id]);
    }
    const link = await createJoinLink(s.adminCtx, { project_ids: [s.project.id] });
    const suffix = { inactive: '0001', active: '0002', history: '0003' }[kind];
    const input = {
      client_request_id: randomUUID(),
      login_id: randomUUID(),
      password: 'password1234',
      profile: {
        name: '가입 기사',
        phone: `0101111${suffix}`,
        business_name: '새 사업자',
        biz_no: `665550${suffix}`,
        plate_no: `서울89가${suffix}`,
        vehicle_type: '카고',
        tonnage: '1',
      },
    };
    const joined = await registerDriver(
      database().db,
      randomUUID(),
      new URL(link.join_url).pathname.split('/').at(-1)!,
      input,
    );
    const before = await getDriverProfile(s.adminCtx, joined.user.id);
    const response = await request(
      profile,
      joined.token,
      { ...input.profile, version: 1, plate_no: vehicle.plate_no },
      'PATCH',
    );
    expect(response.status).toBe(422);
    expect((await response.json()).error.message).toBe(vehicleMessage);
    expect(await getDriverProfile(s.adminCtx, joined.user.id)).toEqual(before);
    expect(
      (await database().pool.query('SELECT vehicle_type,tonnage FROM vehicles WHERE id=$1', [vehicle.id]))
        .rows[0],
    ).toEqual({ vehicle_type: '덤프', tonnage: '25.000' });
    await expect(
      updateDriverProfile(s.adminCtx, joined.user.id, { ...fields(before), plate_no: vehicle.plate_no }),
    ).rejects.toThrow(vehicleMessage);
  },
);

it.each(['inactive', 'active', 'history'] as const)(
  'SEC2-02 기존 %s 공유 차량의 연락처 수정은 허용하되 공유 제원 변경은 거부한다',
  async (kind) => {
    const s = await setupScenario(database().db);
    await database().pool.query('UPDATE counterparties SET biz_no=$1 WHERE id=$2', [
      '332-11-00000',
      s.payee.id,
    ]);
    const other = await s.f.driver({
      active: kind !== 'inactive',
      default_vehicle_id: kind === 'history' ? null : s.vehicle.id,
    });
    if (kind === 'history') {
      await s.f.affiliation(other.id, s.payee.id);
      await createUse(s.adminCtx, { ...s.input, driver_id: other.id });
    }
    const before = await getDriverProfile(s.adminCtx, s.driverUser.id);
    const phone = { inactive: '01012349991', active: '01012349992', history: '01012349993' }[kind];
    await updateDriverProfile(s.driverCtx, s.driverUser.id, { ...fields(before), phone });
    const after = await getDriverProfile(s.adminCtx, s.driverUser.id);
    await expect(
      updateDriverProfile(s.driverCtx, s.driverUser.id, { ...fields(after), tonnage: '25' }),
    ).rejects.toThrow(vehicleMessage);
    await expect(
      updateDriverProfile(s.adminCtx, s.driverUser.id, { ...fields(after), vehicle_type: '덤프' }),
    ).rejects.toThrow(vehicleMessage);
    expect((await getDriverProfile(s.adminCtx, s.driverUser.id)).tonnage).toBe('1.000');
  },
);

it.each([
  { role: 'ADMIN', duplicate: false, suffix: '0001' },
  { role: 'DRIVER', duplicate: false, suffix: '0002' },
  { role: 'ADMIN', duplicate: true, suffix: '0003' },
  { role: 'DRIVER', duplicate: true, suffix: '0004' },
] as const)(
  'SEC2-03 $role 연락처 수정은 현재 CARRIER 소속·기간·계약·과거 스냅샷 유지 (중복 사업자: $duplicate)',
  async ({ role, duplicate, suffix }) => {
    const s = await setupScenario(database().db);
    const bizNo = `443-32-2${suffix}`;
    await database().pool.query('UPDATE counterparties SET biz_no=$1 WHERE id=$2', [bizNo, s.payee.id]);
    // A duplicate legacy DRIVER_BUSINESS must not take precedence over the current affiliation.
    if (duplicate)
      await s.f.counterparty({
        kind: 'DRIVER_BUSINESS',
        biz_no: bizNo,
        name: s.payee.name,
        created_at: new Date(0),
      });
    const old = await createUse(s.adminCtx, s.input);
    const before = await getDriverProfile(s.adminCtx, s.driverUser.id);
    const linksBefore = (
      await database().pool.query('SELECT * FROM driver_affiliations WHERE driver_id=$1', [s.driver.id])
    ).rows;
    await updateDriverProfile(role === 'ADMIN' ? s.adminCtx : s.driverCtx, s.driverUser.id, {
      ...fields(before),
      phone: `0102323${suffix}`,
      biz_no: bizNo.replaceAll('-', ''),
    });
    expect(
      (await database().pool.query('SELECT * FROM driver_affiliations WHERE driver_id=$1', [s.driver.id]))
        .rows,
    ).toEqual(linksBefore);
    const use = await createUse(s.driverCtx, { ...s.input, use_date: todaySeoul() });
    expect(use.payee_counterparty_id).toBe(s.payee.id);
    expect(use.charge_lines[0]).toMatchObject({ unit_price: 300000, rate_agreement_id: s.rate.id });
    expect((await getUse(s.adminCtx, old.id)).snapshot).toEqual(old.snapshot);
  },
);

it('SEC2-02 본인 전용 차량의 제원 수정과 미연결 차량 재사용은 허용한다', async () => {
  const s = await setupScenario(database().db);
  await database().pool.query('UPDATE counterparties SET biz_no=$1 WHERE id=$2', [
    '332-11-99999',
    s.payee.id,
  ]);
  const before = await getDriverProfile(s.adminCtx, s.driverUser.id);
  await createUse(s.driverCtx, s.input);
  const after = await updateDriverProfile(s.driverCtx, s.driverUser.id, {
    ...fields(before),
    phone: '01012348888',
    tonnage: '8.5',
    vehicle_type: '덤프',
  });
  expect(after).toMatchObject({ tonnage: '8.500', vehicle_type: '덤프' });
  const vehicle = await s.f.vehicle({ plate_no: '서울 80아 9876' });
  await updateDriverProfile(s.adminCtx, s.driverUser.id, { ...fields(after), plate_no: '서울80아9876' });
  expect(
    (await database().pool.query('SELECT default_vehicle_id FROM drivers WHERE id=$1', [s.driver.id])).rows[0]
      .default_vehicle_id,
  ).toBe(vehicle.id);
});
