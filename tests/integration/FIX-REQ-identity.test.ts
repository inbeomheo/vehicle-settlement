import { expect, it } from 'vitest';
import { testDatabase } from '../helpers/database';
import { randomUUID } from 'node:crypto';
import { factories, setupScenario } from '../helpers/factories';
import { callRoute } from '../helpers/routes';
import { todaySeoul } from '../../src/server/context';
import { shiftDay } from '../../src/shared/approvals';
import { createJoinLink, registerDriver } from '../../src/server/services/driver-join';
import { createUse } from '../../src/server/services/uses';
import { PATCH } from '../../src/app/api/drivers/[id]/route';
const database = testDatabase();

it('가입한 새 기사의 최초 소속은 1년 전이고 어제 운행을 저장한다', async () => {
  const f = factories(database().db);
  const admin = await f.user();
  const project = await f.project();
  const link = await createJoinLink(f.context(admin), { project_ids: [project.id] });
  const joined = await registerDriver(
    database().db,
    randomUUID(),
    new URL(link.join_url).pathname.split('/').at(-1)!,
    {
      client_request_id: randomUUID(),
      login_id: randomUUID(),
      password: 'password1234',
      profile: {
        name: '사후 입력 기사',
        phone: '01071911234',
        business_name: '사후 입력 운수',
        biz_no: '719-12-12345',
        plate_no: '서울80아7191',
        tonnage: '8',
      },
    },
  );
  const affiliation = (
    await database().pool.query('SELECT valid_from::text FROM driver_affiliations WHERE driver_id=$1', [
      joined.user.driver_id,
    ])
  ).rows[0];
  const expected = (
    await database().pool.query("SELECT ($1::date - interval '1 year')::date::text AS day", [todaySeoul()])
  ).rows[0].day;
  expect(affiliation.valid_from).toBe(expected);
  const user = (await database().pool.query('SELECT * FROM users WHERE id=$1', [joined.user.id])).rows[0];
  const input = {
    use_date: shiftDay(todaySeoul(), -1),
    project_id: project.id,
    driver_id: joined.user.driver_id!,
    vehicle_id: (
      await database().pool.query('SELECT default_vehicle_id FROM drivers WHERE id=$1', [
        joined.user.driver_id,
      ])
    ).rows[0].default_vehicle_id,
  };
  expect((await createUse(f.context(user), input)).use_date).toBe(input.use_date);
  expect((await createUse(f.context(user), { ...input, use_date: expected })).use_date).toBe(expected);
  await expect(createUse(f.context(user), { ...input, use_date: shiftDay(expected, -1) })).rejects.toThrow(
    '소속 시작일',
  );
});

it('소속 없는 날짜 오류는 기사관리 해결 경로를 안내한다', async () => {
  const s = await setupScenario(database().db);
  await database().pool.query('UPDATE driver_affiliations SET valid_from=$1 WHERE id=$2', [
    todaySeoul(),
    s.affiliation.id,
  ]);
  await expect(createUse(s.driverCtx, { ...s.input, use_date: shiftDay(todaySeoul(), -1) })).rejects.toThrow(
    "관리자에게 기사관리에서 '소속 시작일'을 앞당겨 달라고 하세요.",
  );
});

it('관리자·정산 담당자가 소속 시작일 수정: 중복·기간 축소·버전·권한 검증과 감사', async () => {
  const s = await setupScenario(database().db);
  const settlement = await s.f.user({ role: 'SETTLEMENT_MANAGER' });
  const token = (await s.f.session(settlement.id)).token;
  const patch = (body: unknown, session = token) =>
    callRoute(database().db, PATCH, {
      method: 'PATCH',
      path: `/api/drivers/${s.driverUser.id}`,
      params: { id: s.driverUser.id },
      token: session,
      body,
    });
  const body = { version: 1, affiliation_id: s.affiliation.id, valid_from: '2019-01-01' };
  expect((await patch(body)).status).toBe(200);
  expect((await patch(body)).status).toBe(409);
  const logs = (
    await database().pool.query(
      "SELECT * FROM audit_logs WHERE action='UPDATE_DRIVER_AFFILIATION' AND entity_id=$1",
      [s.affiliation.id],
    )
  ).rows;
  expect(logs).toHaveLength(1);
  expect(logs[0].before.valid_from).toBe('2020-01-01');
  expect(logs[0].after.valid_from).toBe('2019-01-01');
  const expired = await s.f.affiliation(s.driver.id, s.payee.id, {
    valid_from: '2018-01-01',
    valid_to: '2018-12-31',
  });
  expect(
    (await patch({ ...body, version: 2, affiliation_id: expired.id, valid_from: '2019-01-01' })).status,
  ).toBe(422);
  expect((await patch({ ...body, version: 2, valid_from: '2018-12-31' })).status).toBe(422);
  const existing = await createUse(s.driverCtx, s.input);
  const snapshotBefore = (
    await database().pool.query('SELECT snapshot FROM vehicle_uses WHERE id=$1', [existing.id])
  ).rows[0].snapshot;
  expect((await patch({ ...body, version: 2, valid_from: '2026-09-16' })).status).toBe(422);
  expect((await patch({ ...body, version: 2, valid_from: '2026-02-30' })).status).toBe(422);
  expect((await patch({ ...body, version: 2, affiliation_id: randomUUID() })).status).toBe(404);
  const adminToken = (await s.f.session(s.admin.id)).token;
  expect((await patch({ ...body, version: 2, valid_from: '2018-12-31' }, adminToken)).status).toBe(422);
  expect((await patch({ ...body, version: 2, valid_from: '2019-02-01' }, adminToken)).status).toBe(200);
  for (const user of [s.driverUser, await s.f.user({ role: 'SITE_MANAGER' })]) {
    expect((await patch({ ...body, version: 3 }, (await s.f.session(user.id)).token)).status).toBe(403);
  }
  expect(
    (await database().pool.query('SELECT version FROM users WHERE id=$1', [s.driverUser.id])).rows[0].version,
  ).toBe(3);
  expect(
    (await database().pool.query('SELECT snapshot FROM vehicle_uses WHERE id=$1', [existing.id])).rows[0]
      .snapshot,
  ).toEqual(snapshotBefore);
  const options = {
    method: 'PATCH',
    path: `/api/drivers/${s.driverUser.id}`,
    params: { id: s.driverUser.id },
    token,
    headers: { 'idempotency-key': randomUUID() },
    body: { ...body, version: 3, valid_from: '2019-01-01' },
  };
  expect((await callRoute(database().db, PATCH, options)).status).toBe(200);
  const replay = await callRoute(database().db, PATCH, options);
  expect(replay.headers.get('idempotency-replayed')).toBe('true');
  expect((await replay.json()).data.version).toBe(4);
});
