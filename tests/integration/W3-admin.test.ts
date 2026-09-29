import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { callRoute } from '../helpers/routes';
import { addRatePeriod, saveRate } from '../../src/server/services/admin-rates';
import {
  saveMaster,
  listMaster,
  updateUser,
  addAssignment,
  revokeAssignment,
  listUsers,
} from '../../src/server/services/admin';
import { createUse, getUse } from '../../src/server/services/uses';
import { queryAudit } from '../../src/server/services/audit-query';
import { getLookups } from '../../src/server/services/lookups';
import { rateAgreements, sessions, auditLogs, projectAssignments } from '../../src/server/db/schema';
import { GET as ledger } from '../../src/app/api/ledger/route';
import { GET as useRoute } from '../../src/app/api/uses/[id]/route';
import { GET as userList } from '../../src/app/api/admin/users/route';
import { PATCH as patchUser } from '../../src/app/api/admin/users/[id]/route';
import { POST as invite } from '../../src/app/api/invites/route';
import { POST as accept } from '../../src/app/api/invites/[id]/accept/route';
import { DELETE as revokeInvite } from '../../src/app/api/invites/[id]/route';
const database = testDatabase();
it('참조된 계약 가격 수정 거부 → 새 적용기간 추가 → 과거 금액 보존·새 단가 적용', async () => {
  const s = await setupScenario(database().db);
  const old = await createUse(s.adminCtx, s.input);
  await expect(saveRate(s.adminCtx, { version: 1, unit_price: 400000 }, s.rate.id)).rejects.toMatchObject({
    code: 'VALIDATION_FAILED',
  });
  const next = await addRatePeriod(s.adminCtx, s.rate.id, {
    version: 1,
    valid_from: '2026-10-01',
    unit_price: 400000,
  });
  const [closed] = await database().db.select().from(rateAgreements).where(eq(rateAgreements.id, s.rate.id));
  expect(closed.valid_to).toBe('2026-09-30');
  expect(next.unit_price).toBe(400000);
  const current = await createUse(s.adminCtx, { ...s.input, use_date: '2026-10-02' });
  expect(current.charge_lines[0].computed_amount).toBe(400000);
  expect(current.charge_lines[0].rate_agreement_id).toBe(next.id);
  expect((await getUse(s.adminCtx, old.id)).charge_lines[0]).toMatchObject({
    computed_amount: 300000,
    agreement_snapshot: { unit_price: 300000 },
  });
  const history = await queryAudit(s.adminCtx, { entity_type: 'rate_agreement' });
  expect(JSON.stringify(history)).toContain('CLOSE_RATE_PERIOD');
  expect(JSON.stringify(history)).toContain('ADD_RATE_PERIOD');
});
it('참조된 계약의 기간·과금·세금 변경은 거절하고 명칭·사용중지는 허용한다', async () => {
  const s = await setupScenario(database().db);
  await createUse(s.adminCtx, s.input);
  for (const patch of [
    { valid_to: '2026-12-01' },
    { billing_unit: 'PER_HOUR' },
    { tax_mode: 'TAX_EXEMPT' },
    { rounding: 'DOWN' },
    { min_charge: 100 },
    { direction: 'RECEIVABLE' },
  ])
    await expect(saveRate(s.adminCtx, { version: 1, ...patch }, s.rate.id)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  const after = await saveRate(s.adminCtx, { version: 1, name: '과거 계약', active: false }, s.rate.id);
  expect(after.active).toBe(false);
  expect(after.unit_price).toBe(300000);
  await expect(saveRate(s.adminCtx, { version: 1, name: '동시 수정' }, s.rate.id)).rejects.toMatchObject({
    code: 'VERSION_CONFLICT',
  });
});
it('계약 기간 경계 중복·동시 등록을 거부하고 더 구체적인 조건은 허용한다', async () => {
  const s = await setupScenario(database().db);
  const fields = {
    name: '새 계약',
    direction: 'PAYABLE',
    counterparty_id: s.payee.id,
    billing_unit: 'PER_DAY',
    unit_price: 1,
    valid_from: '2026-10-01',
  };
  await expect(saveRate(s.adminCtx, fields)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  await saveRate(s.adminCtx, { ...fields, project_id: s.project.id });
  const newParty = await s.f.counterparty();
  const attempts = await Promise.allSettled([
    saveRate(s.adminCtx, { ...fields, counterparty_id: newParty.id }),
    saveRate(s.adminCtx, { ...fields, counterparty_id: newParty.id }),
  ]);
  expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  await saveRate(s.adminCtx, { version: 1, valid_to: '2026-09-30' }, s.rate.id);
  await expect(saveRate(s.adminCtx, { ...fields, valid_from: '2026-09-30' })).rejects.toMatchObject({
    code: 'VALIDATION_FAILED',
  });
  expect((await saveRate(s.adminCtx, fields)).valid_from).toBe('2026-10-01');
});
it('기존 참조일을 침범하는 새 기간은 거부하고 실패 시 종료일도 롤백한다', async () => {
  const s = await setupScenario(database().db);
  await createUse(s.adminCtx, s.input);
  await expect(
    addRatePeriod(s.adminCtx, s.rate.id, { version: 1, valid_from: '2026-09-10', unit_price: 5 }),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  await s.f.rate(s.payee.id, { valid_from: '2027-01-01' });
  await expect(
    addRatePeriod(s.adminCtx, s.rate.id, { version: 1, valid_from: '2026-10-01', unit_price: 5 }),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  const [row] = await database().db.select().from(rateAgreements).where(eq(rateAgreements.id, s.rate.id));
  expect(row.valid_to).toBeNull();
  expect(row.version).toBe(1);
});
it('사용중지는 신규 선택만 제외하며 snapshot 과거 이름과 audit 전후 값을 보존한다', async () => {
  const s = await setupScenario(database().db);
  const use = await createUse(s.adminCtx, s.input);
  await saveMaster(s.adminCtx, 'projects', { name: '변경 현장', active: false }, s.project.id);
  expect((await getLookups(s.adminCtx)).projects.some((p) => p.id === s.project.id)).toBe(false);
  expect((await getUse(s.adminCtx, use.id)).snapshot.project_name).toBe(s.project.name);
  expect((await listMaster(s.adminCtx, 'projects')).find((p) => p.id === s.project.id)).toMatchObject({
    name: '변경 현장',
    active: false,
  });
  const logs = await database().db.select().from(auditLogs).where(eq(auditLogs.entity_id, s.project.id));
  expect(logs[0].before).toMatchObject({ name: s.project.name });
  expect(logs[0].after).toMatchObject({ active: false });
});
it('소속 기간은 중복을 거부하고 기간·거래처 종류를 검증한다', async () => {
  const s = await setupScenario(database().db);
  await expect(
    saveMaster(s.adminCtx, 'affiliations', {
      driver_id: s.driver.id,
      counterparty_id: s.payee.id,
      valid_from: '2026-01-01',
    }),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  await saveMaster(s.adminCtx, 'affiliations', { valid_to: '2026-09-30' }, s.affiliation.id);
  expect(
    await saveMaster(s.adminCtx, 'affiliations', {
      driver_id: s.driver.id,
      counterparty_id: s.payee.id,
      valid_from: '2026-10-01',
    }),
  ).toMatchObject({ driver_id: s.driver.id });
  await expect(
    saveMaster(s.adminCtx, 'affiliations', {
      driver_id: s.driver.id,
      counterparty_id: s.payee.id,
      valid_from: '2028-01-01',
      valid_to: '2027-01-01',
    }),
  ).rejects.toThrow();
  const customer = await s.f.counterparty({ kind: 'CUSTOMER' });
  const driver = await s.f.driver();
  await expect(
    saveMaster(s.adminCtx, 'affiliations', {
      driver_id: driver.id,
      counterparty_id: customer.id,
      valid_from: '2026-01-01',
    }),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
});
it('비활성화는 모든 세션을 즉시 폐기하며 멱등 재요청도 로그인 상태를 재검사한다', async () => {
  const s = await setupScenario(database().db);
  const target = await s.f.user({ role: 'SITE_MANAGER' });
  const a = await s.f.session(target.id);
  await s.f.session(target.id);
  const admin = await s.f.session(s.admin.id);
  const response = await callRoute(database().db, patchUser, {
    token: admin.token,
    method: 'PATCH',
    params: { id: target.id },
    path: `/api/admin/users/${target.id}`,
    headers: { 'idempotency-key': crypto.randomUUID() },
    body: { version: target.version, status: 'DISABLED' },
  });
  expect(response.status).toBe(200);
  expect((await callRoute(database().db, ledger, { token: a.token })).status).toBe(401);
  const rows = await database().db.select().from(sessions).where(eq(sessions.user_id, target.id));
  expect(rows.every((session) => session.revoked_at)).toBe(true);
  await updateUser(s.adminCtx, target.id, { version: 2, status: 'ACTIVE' });
  expect((await callRoute(database().db, ledger, { token: a.token })).status).toBe(401);
});
it('배정 회수·역할 변경·all_projects 회수는 기존 세션에 즉시 반영한다', async () => {
  const s = await setupScenario(database().db);
  const use = await createUse(s.adminCtx, s.input);
  const target = await s.f.user({ role: 'SETTLEMENT_MANAGER', all_projects: true });
  const { token } = await s.f.session(target.id);
  const read = () => callRoute(database().db, useRoute, { token, params: { id: use.id } });
  expect((await read()).status).toBe(200);
  await updateUser(s.adminCtx, target.id, { version: 1, all_projects: false });
  expect((await read()).status).toBe(404);
  const assignment = await addAssignment(s.adminCtx, {
    user_id: target.id,
    project_id: s.project.id,
    valid_from: '2020-01-01',
  });
  expect((await read()).status).toBe(200);
  await revokeAssignment(s.adminCtx, assignment.id);
  expect((await read()).status).toBe(404);
  const listing = await callRoute(database().db, ledger, { token });
  expect((await listing.json()).data.total).toBe(0);
  await updateUser(s.adminCtx, target.id, { version: 2, role: 'DRIVER', driver_id: s.driver.id });
  expect((await callRoute(database().db, ledger, { token })).status).toBe(403);
});
it('초대 링크는 1회만 수락되며 취소·재사용은 거부한다', async () => {
  const s = await setupScenario(database().db);
  const { token } = await s.f.session(s.admin.id);
  const create = () =>
    callRoute(database().db, invite, {
      token,
      method: 'POST',
      body: { role: 'SITE_MANAGER', name: '새 담당자', project_ids: [s.project.id] },
    });
  const response = await create();
  expect(response.status).toBe(200);
  const data = (await response.json()).data;
  expect(data.token_hash).toBeUndefined();
  const invitationToken = data.invite_url.split('/').at(-1);
  const input = {
    method: 'POST',
    params: { id: invitationToken },
    body: { login_id: `invite-${crypto.randomUUID()}`, password: 'password1234' },
  };
  expect((await callRoute(database().db, accept, input)).status).toBe(200);
  expect((await callRoute(database().db, accept, input)).status).toBe(404);
  const canceled = (await (await create()).json()).data;
  expect(
    (await callRoute(database().db, revokeInvite, { token, method: 'DELETE', params: { id: canceled.id } }))
      .status,
  ).toBe(200);
  expect(
    (
      await callRoute(database().db, accept, {
        ...input,
        params: { id: canceled.invite_url.split('/').at(-1) },
      })
    ).status,
  ).toBe(404);
});
it('사용자 응답과 감사로그에 비밀번호·토큰을 노출하지 않고 기사 관리자 API는 거부한다', async () => {
  const s = await setupScenario(database().db);
  const rows = await listUsers(s.adminCtx);
  expect(JSON.stringify(rows)).not.toContain('password_hash');
  const { token } = await s.f.session(s.driverUser.id);
  expect((await callRoute(database().db, userList, { token })).status).toBe(403);
  await expect(saveMaster(s.driverCtx, 'work-types', { name: '무단 등록' })).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  await database()
    .db.insert(auditLogs)
    .values({
      action: 'TEST',
      entity_type: 'test',
      user_id: s.admin.id,
      after: { password_hash: 'secret', nested: { token_hash: 'secret', storage_key: 'secret' } },
      request_id: crypto.randomUUID(),
    });
  expect(JSON.stringify(await queryAudit(s.adminCtx, { entity_type: 'test' }))).not.toContain('secret');
});
it('중복 배정·기사 연결 없는 역할 변경·허용되지 않은 all_projects는 거부한다', async () => {
  const s = await setupScenario(database().db);
  await expect(
    addAssignment(s.adminCtx, {
      user_id: s.driverUser.id,
      project_id: s.project.id,
      valid_from: '2026-01-01',
    }),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  await expect(
    updateUser(s.adminCtx, s.admin.id, { version: 1, role: 'DRIVER', driver_id: null }),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  await expect(
    updateUser(s.adminCtx, s.driverUser.id, { version: 1, all_projects: true }),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(
    (
      await database().db.select().from(projectAssignments).where(eq(projectAssignments.id, s.assignment.id))
    )[0].revoked_at,
  ).toBeNull();
});

it('기준정보 모든 자원 등록·수정은 감사로그를 남기고 회사는 단일 행으로 관리한다', async () => {
  const s = await setupScenario(database().db);
  const work = await saveMaster(s.adminCtx, 'work-types', { name: '토공' });
  await saveMaster(s.adminCtx, 'work-types', { active: false }, String(work.id));
  const party = await saveMaster(s.adminCtx, 'counterparties', {
    name: '신규 운송',
    kind: 'CARRIER',
    biz_no: '123-45-67890',
    bank_account: '테스트 계좌',
  });
  const vehicle = await saveMaster(s.adminCtx, 'vehicles', {
    plate_no: `W3-${crypto.randomUUID()}`,
    vehicle_type: '덤프',
    tonnage: '25.5',
  });
  const driver = await saveMaster(s.adminCtx, 'drivers', {
    name: '신규 기사',
    phone: '010-0000-1234',
    default_vehicle_id: vehicle.id,
  });
  await saveMaster(s.adminCtx, 'affiliations', {
    driver_id: driver.id,
    counterparty_id: party.id,
    valid_from: '2026-01-01',
  });
  const company = await saveMaster(s.adminCtx, 'company', {
    name: '테스트 회사',
    default_tax_mode: 'VAT_EXCLUDED',
  });
  await saveMaster(s.adminCtx, 'company', { representative: '담당 대표' }, String(company.id));
  expect((await listMaster(s.adminCtx, 'company'))[0]).toMatchObject({
    name: '테스트 회사',
    representative: '담당 대표',
  });
  expect(await listMaster(s.adminCtx, 'company')).toHaveLength(1);
  const logs = await queryAudit(s.adminCtx, { user_id: s.admin.id });
  expect(logs.total).toBe(8);
  await expect(
    saveMaster(s.adminCtx, 'drivers', { name: '무단 필드', password_hash: '입력 불가' }),
  ).rejects.toThrow();
});

it('사용중지 기준정보를 신규 연결로 선택할 수 없지만 기존 연결은 유지한다', async () => {
  const s = await setupScenario(database().db);
  await saveMaster(s.adminCtx, 'vehicles', { active: false }, s.vehicle.id);
  await expect(
    saveMaster(s.adminCtx, 'drivers', { name: '새 기사', default_vehicle_id: s.vehicle.id }),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  await expect(
    saveMaster(s.adminCtx, 'drivers', { phone: '010-0000-1111' }, s.driver.id),
  ).resolves.toMatchObject({ default_vehicle_id: s.vehicle.id });
  await saveMaster(s.adminCtx, 'counterparties', { active: false }, s.payee.id);
  await expect(
    saveRate(s.adminCtx, {
      name: '신규',
      direction: 'PAYABLE',
      counterparty_id: s.payee.id,
      billing_unit: 'PER_HOUR',
      unit_price: 10000,
      valid_from: '2026-01-01',
    }),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
});

it('진행 중인 사용 등록이 기존 계약을 참조하면 기간 종료는 기다린 후 재검증한다', async () => {
  const s = await setupScenario(database().db);
  let selected!: () => void;
  const readRate = new Promise<void>((resolve) => {
    selected = resolve;
  });
  let continueCreate!: () => void;
  const createAllowed = new Promise<void>((resolve) => {
    continueCreate = resolve;
  });
  const creating = database().db.transaction(async (db) => {
    await db.select().from(rateAgreements).where(eq(rateAgreements.id, s.rate.id));
    selected();
    await createAllowed;
    return createUse({ ...s.adminCtx, db }, { ...s.input, use_date: '2026-10-15' });
  });
  await readRate;
  const ending = addRatePeriod(s.adminCtx, s.rate.id, {
    version: 1,
    valid_from: '2026-10-01',
    unit_price: 400000,
  });
  const rejected = expect(ending).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  continueCreate();
  expect((await creating).charge_lines[0].computed_amount).toBe(300000);
  await rejected;
  const [rate] = await database().db.select().from(rateAgreements).where(eq(rateAgreements.id, s.rate.id));
  expect(rate.valid_to).toBeNull();
});

it('희소 PATCH·새 적용기간은 생략한 조건을 기본값으로 덮어쓰지 않는다', async () => {
  const s = await setupScenario(database().db);
  const original = await saveRate(
    s.adminCtx,
    {
      version: 1,
      project_id: s.project.id,
      vehicle_type: '카고',
      tonnage: '1',
      tax_mode: 'VAT_INCLUDED',
      rounding: 'DOWN',
      min_charge: 330000,
      active: false,
    },
    s.rate.id,
  );
  const renamed = await saveRate(s.adminCtx, { version: original.version, name: '이름만 변경' }, s.rate.id);
  expect(renamed).toMatchObject({
    project_id: s.project.id,
    vehicle_type: '카고',
    tonnage: '1.000',
    tax_mode: 'VAT_INCLUDED',
    rounding: 'DOWN',
    min_charge: 330000,
    active: false,
  });
  const next = await addRatePeriod(s.adminCtx, s.rate.id, {
    version: renamed.version,
    valid_from: '2026-10-01',
    unit_price: 440000,
  });
  expect(next).toMatchObject({
    project_id: s.project.id,
    vehicle_type: '카고',
    tonnage: '1.000',
    tax_mode: 'VAT_INCLUDED',
    rounding: 'DOWN',
    min_charge: 330000,
    active: true,
  });
  await saveMaster(s.adminCtx, 'projects', { active: false }, s.project.id);
  expect(await saveMaster(s.adminCtx, 'projects', { name: '이름만 변경' }, s.project.id)).toMatchObject({
    active: false,
  });
});
