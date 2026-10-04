import { expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { testDatabase } from '../helpers/database';
import { factories, setupScenario } from '../helpers/factories';
import { callRoute } from '../helpers/routes';
import * as route from '../../src/app/api/admin/users/[id]/route';
import { listUsers } from '../../src/server/services/admin';
import { deleteUser } from '../../src/server/services/user-deletion';
import { listDriverProfiles } from '../../src/server/services/driver-profiles';
import { createUse } from '../../src/server/services/uses';
import {
  auditLogs,
  users,
  drivers,
  vehicles,
  counterparties,
  useRevisions,
} from '../../src/server/db/schema';

const database = testDatabase();
async function remove(actor: string, id: string, version = 1, key = crypto.randomUUID()) {
  const { token } = await factories(database().db).session(actor);
  expect(route).toHaveProperty('DELETE');
  return callRoute(database().db, (route as typeof route & { DELETE: typeof route.PATCH }).DELETE, {
    method: 'DELETE',
    path: `/api/admin/users/${id}`,
    params: { id },
    token,
    headers: { 'idempotency-key': key },
    body: { version },
  });
}
it('기록 없는 기사와 전용 사업자·차량, 인증·가입·배정 정보를 정리하고 감사만 보존한다', async () => {
  const s = await setupScenario(database().db);
  const party = await s.f.counterparty({ kind: 'DRIVER_BUSINESS' });
  await database().db.execute(
    sql`UPDATE driver_affiliations SET counterparty_id=${party.id} WHERE driver_id=${s.driver.id}`,
  );
  await s.f.session(s.driverUser.id);
  await database().db.execute(
    sql`INSERT INTO push_subscriptions(user_id, endpoint, keys) VALUES (${s.driverUser.id}, 'https://example.com/delete', '{}')`,
  );
  await database().db.execute(
    sql`INSERT INTO password_resets(user_id, created_by, token_hash, expires_at) VALUES (${s.driverUser.id}, ${s.admin.id}, 'delete-reset', now()+interval '1 day')`,
  );
  await database().db.execute(
    sql`INSERT INTO invites(id,token_hash,role,name,driver_id,project_ids,expires_at,used_by_user_id,created_by) VALUES ('10000000-0000-4000-8000-000000000001','delete-invite','DRIVER','가입',${s.driver.id},'[]',now(),${s.driverUser.id},${s.admin.id})`,
  );
  await database().db.execute(
    sql`INSERT INTO driver_registrations(client_request_id,request_hash,invite_id,user_id) VALUES (gen_random_uuid(),'test','10000000-0000-4000-8000-000000000001',${s.driverUser.id})`,
  );
  await database().db.insert(auditLogs).values({
    user_id: s.driverUser.id,
    action: 'LOGIN',
    entity_type: 'user',
    entity_id: s.driverUser.id,
    request_id: 'old',
  });
  expect((await listUsers(s.adminCtx)).find((u) => u.id === s.driverUser.id)).toMatchObject({
    deletable: true,
    delete_reason: null,
  });
  expect((await listDriverProfiles(s.adminCtx)).find((u) => u.id === s.driverUser.id)).toMatchObject({
    deletable: true,
  });
  const key = crypto.randomUUID();
  const result = await remove(s.admin.id, s.driverUser.id, 1, key);
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({ data: { id: s.driverUser.id, deleted: true } });
  expect((await remove(s.admin.id, s.driverUser.id, 1, key)).status).toBe(200);
  expect((await remove(s.admin.id, s.driverUser.id)).status).toBe(200);
  for (const [table, id] of [
    [users, s.driverUser.id],
    [drivers, s.driver.id],
    [vehicles, s.vehicle.id],
    [counterparties, party.id],
  ] as const)
    expect(await database().db.select().from(table).where(eq(table.id, id))).toHaveLength(0);
  for (const table of [
    'sessions',
    'push_subscriptions',
    'password_resets',
    'project_assignments',
    'driver_registrations',
  ])
    expect(
      (
        await database().db.execute(
          sql`SELECT * FROM ${sql.identifier(table)} WHERE user_id=${s.driverUser.id}`,
        )
      ).rows,
    ).toHaveLength(0);
  expect(
    (await database().db.execute(sql`SELECT * FROM invites WHERE used_by_user_id=${s.driverUser.id}`)).rows,
  ).toHaveLength(0);
  const logs = await database().db.select().from(auditLogs).where(eq(auditLogs.entity_id, s.driverUser.id));
  expect(logs.find((l) => l.action === 'LOGIN')?.user_id).toBeNull();
  expect(logs.filter((l) => l.action === 'DELETE_USER')).toHaveLength(1);
  expect(logs.find((l) => l.action === 'DELETE_USER')?.before).toMatchObject({ name: s.driverUser.name });
  expect(JSON.stringify(logs)).not.toMatch(/password_hash|token_hash/);
});
it('초안 운행 및 승인 담당자 참조는 목록과 삭제 API에서 모두 거부한다', async () => {
  const s = await setupScenario(database().db);
  const reviewer = await s.f.user({ role: 'SITE_MANAGER' });
  const use = await createUse(s.adminCtx, s.input);
  await database().db.insert(useRevisions).values({
    vehicle_use_id: use.id,
    revision_no: 1,
    snapshot: {},
    submitted_by: s.admin.id,
    decided_by: reviewer.id,
    decision: 'APPROVED',
  });
  for (const id of [s.driverUser.id, reviewer.id]) {
    expect((await listUsers(s.adminCtx)).find((u) => u.id === id)).toMatchObject({
      deletable: false,
      delete_reason: expect.stringContaining('운행·정산 기록'),
    });
    const result = await remove(s.admin.id, id);
    expect(result.status).toBe(422);
    expect((await result.json()).error.message).toBe(
      "운행·정산 기록이 있어 삭제할 수 없어요. '계정 끄기'를 쓰세요.",
    );
  }
});
it('공유 사업자·차량과 다른 계정에 연결된 기사는 보존한다', async () => {
  const s = await setupScenario(database().db);
  const party = await s.f.counterparty({ kind: 'DRIVER_BUSINESS' });
  await database().db.execute(
    sql`UPDATE driver_affiliations SET counterparty_id=${party.id} WHERE driver_id=${s.driver.id}`,
  );
  const other = await s.f.driver({ default_vehicle_id: s.vehicle.id });
  await s.f.affiliation(other.id, party.id);
  expect((await remove(s.admin.id, s.driverUser.id)).status).toBe(200);
  expect(await database().db.select().from(vehicles).where(eq(vehicles.id, s.vehicle.id))).toHaveLength(1);
  expect(
    await database().db.select().from(counterparties).where(eq(counterparties.id, party.id)),
  ).toHaveLength(1);
  const u1 = await s.f.user({ role: 'DRIVER', driver_id: other.id });
  const u2 = await s.f.user({ role: 'DRIVER', driver_id: other.id });
  expect((await remove(s.admin.id, u1.id)).status).toBe(200);
  expect(await database().db.select().from(drivers).where(eq(drivers.id, other.id))).toHaveLength(1);
  expect(await database().db.select().from(users).where(eq(users.id, u2.id))).toHaveLength(1);
});
it('버전 충돌·자기 삭제·관리자 외 요청을 거부하며 기록 없는 담당자는 삭제한다', async () => {
  const s = await setupScenario(database().db);
  const target = await s.f.user({ role: 'SITE_MANAGER' });
  expect((await remove(s.admin.id, target.id, 2)).status).toBe(409);
  expect((await remove(s.admin.id, s.admin.id)).status).toBe(422);
  expect((await remove(target.id, s.driverUser.id)).status).toBe(403);
  expect((await remove(s.admin.id, target.id)).status).toBe(200);
});
it('마지막 활성 관리자는 삭제 불가 안내를 반환한다', async () => {
  const db = await import('../helpers/database').then((m) => m.createTestDatabase());
  try {
    const f = factories(db.db);
    const admin = await f.user();
    expect((await listUsers(f.context(admin)))[0]).toMatchObject({
      deletable: false,
      delete_reason: expect.stringContaining('마지막 활성 관리자'),
    });
    const { token } = await f.session(admin.id);
    const response = await callRoute(db.db, route.DELETE, {
      method: 'DELETE',
      token,
      params: { id: admin.id },
      body: { version: 1 },
    });
    expect(response.status).toBe(422);
    expect((await response.json()).error.message).toContain('마지막 활성 관리자');
  } finally {
    await db.cleanup();
  }
});

it.each([
  ['vehicle_uses', 'created_by_user_id'],
  ['vehicle_uses', 'reviewer_user_id'],
  ['use_revisions', 'submitted_by'],
  ['use_revisions', 'decided_by'],
  ['evidence', 'uploaded_by'],
  ['statements', 'created_by'],
  ['statements', 'confirmed_by'],
  ['statements', 'canceled_by'],
  ['payment_records', 'recorded_by'],
  ['payment_records', 'voided_by'],
  ['import_jobs', 'created_by'],
  ['import_presets', 'created_by'],
  ['form_field_settings', 'updated_by'],
])('%s.%s 업무 FK는 단독 참조만 있어도 삭제를 거부한다', async (table, column) => {
  const s = await setupScenario(database().db);
  const target = await s.f.user({ role: 'SITE_MANAGER' });
  const db = database().db;
  const use = await createUse(s.adminCtx, s.input);
  if (table === 'vehicle_uses')
    await db.execute(sql`UPDATE vehicle_uses SET ${sql.identifier(column)}=${target.id} WHERE id=${use.id}`);
  if (table === 'use_revisions')
    await db.execute(
      sql`INSERT INTO use_revisions(vehicle_use_id,revision_no,snapshot,submitted_by,decided_by) VALUES (${use.id},1,'{}',${column === 'submitted_by' ? target.id : s.admin.id},${column === 'decided_by' ? target.id : null})`,
    );
  if (table === 'evidence')
    await db.execute(
      sql`INSERT INTO evidence(vehicle_use_id,kind,client_upload_id,uploaded_by,deleted_at) VALUES (${use.id},'PHOTO',${crypto.randomUUID()},${target.id},now())`,
    );
  if (table === 'statements' || table === 'payment_records') {
    const statement = (
      await db.execute(
        sql`INSERT INTO statements(direction,counterparty_id,period_start,period_end,created_by,confirmed_by,canceled_by) VALUES ('PAYABLE',${s.payee.id},'2026-09-01','2026-09-30',${column === 'created_by' ? target.id : s.admin.id},${column === 'confirmed_by' ? target.id : null},${column === 'canceled_by' ? target.id : null}) RETURNING id`,
      )
    ).rows[0];
    if (table === 'payment_records')
      await db.execute(
        sql`INSERT INTO payment_records(statement_id,kind,amount,paid_on,method,recorded_by,voided_by,voided_at) VALUES (${statement.id},'PAYMENT',0,'2026-09-30','이체',${column === 'recorded_by' ? target.id : s.admin.id},${column === 'voided_by' ? target.id : null},now())`,
      );
  }
  if (table === 'import_jobs')
    await db.execute(sql`INSERT INTO import_jobs(file_name,created_by) VALUES ('보존.xlsx',${target.id})`);
  if (table === 'import_presets')
    await db.execute(
      sql`INSERT INTO import_presets(name,mapping,created_by) VALUES ('보존','{}',${target.id})`,
    );
  if (table === 'form_field_settings')
    await db.execute(
      sql`INSERT INTO form_field_settings(project_id,field_key,updated_by) VALUES (${s.project.id},'reviewer',${target.id})`,
    );
  expect((await listUsers(s.adminCtx)).find((u) => u.id === target.id)).toMatchObject({ deletable: false });
  expect((await remove(s.admin.id, target.id)).status).toBe(422);
  expect(
    (
      await db.execute(
        sql`SELECT 1 FROM ${sql.identifier(table)} WHERE ${sql.identifier(column)}=${target.id}`,
      )
    ).rows,
  ).toHaveLength(1);
});
it('현재 운행 기사와 달라도 증빙 귀속·명세 스냅샷의 기사 기록은 보존한다', async () => {
  const s = await setupScenario(database().db);
  const use = await createUse(s.adminCtx, s.input);
  for (const kind of ['evidence', 'statement_items']) {
    const driver = await s.f.driver();
    const target = await s.f.user({ role: 'DRIVER', driver_id: driver.id });
    if (kind === 'evidence')
      await database().db.execute(
        sql`INSERT INTO evidence(vehicle_use_id,owner_driver_id,kind,client_upload_id,uploaded_by,deleted_at) VALUES (${use.id},${driver.id},'PHOTO',${crypto.randomUUID()},${s.admin.id},now())`,
      );
    else {
      const statement = (
        await database().db.execute(
          sql`INSERT INTO statements(direction,counterparty_id,period_start,period_end,created_by) VALUES ('PAYABLE',${s.payee.id},'2026-09-01','2026-09-30',${s.admin.id}) RETURNING id`,
        )
      ).rows[0];
      await database().db.execute(
        sql`INSERT INTO statement_items(statement_id,charge_line_id,snapshot) VALUES (${statement.id},${use.charge_lines[0].id},${JSON.stringify({ driver_id: driver.id })}::jsonb)`,
      );
    }
    expect((await remove(s.admin.id, target.id)).status).toBe(422);
  }
});
it('전용 사업자라도 계약에서 쓰면 보존하고 운송사는 삭제하지 않는다', async () => {
  const s = await setupScenario(database().db);
  const party = await s.f.counterparty({ kind: 'DRIVER_BUSINESS' });
  await s.f.affiliation(s.driver.id, party.id, { valid_from: '2010-01-01', valid_to: '2011-01-01' });
  await s.f.rate(party.id);
  expect((await remove(s.admin.id, s.driverUser.id)).status).toBe(200);
  expect(
    await database().db.select().from(counterparties).where(eq(counterparties.id, party.id)),
  ).toHaveLength(1);
  expect(
    await database().db.select().from(counterparties).where(eq(counterparties.id, s.payee.id)),
  ).toHaveLength(1);
});
it('삭제한 관리자의 초대·가입 링크·재설정 생성 참조를 정리하고 가입된 다른 계정은 유지한다', async () => {
  const s = await setupScenario(database().db);
  const target = await s.f.user();
  const link = (
    await database().db.execute(
      sql`INSERT INTO driver_join_links(token_hash,project_ids,expires_at,created_by) VALUES (${crypto.randomUUID()},'[]',now(),${target.id}) RETURNING id`,
    )
  ).rows[0];
  await database().db.execute(
    sql`INSERT INTO driver_registrations(client_request_id,request_hash,link_id,user_id) VALUES (gen_random_uuid(),'test',${link.id},${s.driverUser.id})`,
  );
  await database().db.execute(
    sql`INSERT INTO password_resets(user_id,token_hash,expires_at,created_by) VALUES (${s.driverUser.id},${crypto.randomUUID()},now(),${target.id})`,
  );
  expect((await remove(s.admin.id, target.id)).status).toBe(200);
  expect(await database().db.select().from(users).where(eq(users.id, s.driverUser.id))).toHaveLength(1);
  expect(
    (await database().db.execute(sql`SELECT * FROM driver_join_links WHERE id=${link.id}`)).rows,
  ).toHaveLength(0);
});
it('새 업무 FK가 추가되어도 삭제 가능 판정과 삭제는 보수적으로 차단한다', async () => {
  const s = await setupScenario(database().db);
  const target = await s.f.user({ role: 'SITE_MANAGER' });
  await database().db.execute(
    sql`CREATE TABLE deletion_future_records (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid REFERENCES users(id))`,
  );
  await database().db.execute(sql`INSERT INTO deletion_future_records(actor_id) VALUES (${target.id})`);
  expect((await listUsers(s.adminCtx)).find((u) => u.id === target.id)).toMatchObject({ deletable: false });
  expect((await remove(s.admin.id, target.id)).status).toBe(422);
});

it('현재 기사 연결이 바뀌어도 과거 제출본에 남은 기사 계정은 삭제하지 않는다', async () => {
  const s = await setupScenario(database().db);
  const use = await createUse(s.adminCtx, s.input);
  const oldDriver = await s.f.driver();
  const target = await s.f.user({ role: 'DRIVER', driver_id: oldDriver.id });
  await database()
    .db.insert(useRevisions)
    .values({
      vehicle_use_id: use.id,
      revision_no: 1,
      snapshot: { driver_id: oldDriver.id },
      submitted_by: s.admin.id,
    });
  expect((await remove(s.admin.id, target.id)).status).toBe(422);
});

it('동시에 등록 중인 초안이 커밋되면 잠금 뒤 재검사하여 계정 삭제를 거부한다', async () => {
  const s = await setupScenario(database().db);
  let inserted!: () => void;
  const ready = new Promise<void>((resolve) => {
    inserted = resolve;
  });
  let finish!: () => void;
  const release = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const writing = database().db.transaction(async (db) => {
    const use = await createUse({ ...s.adminCtx, db }, s.input);
    inserted();
    await release;
    return use;
  });
  await ready;
  const deleting = deleteUser(s.adminCtx, s.driverUser.id, { version: 1 });
  const refused = expect(deleting).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  finish();
  const use = await writing;
  await refused;
  expect((await database().db.execute(sql`SELECT 1 FROM vehicle_uses WHERE id=${use.id}`)).rows).toHaveLength(
    1,
  );
  expect(await database().db.select().from(users).where(eq(users.id, s.driverUser.id))).toHaveLength(1);
});
