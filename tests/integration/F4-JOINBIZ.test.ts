import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { testDatabase } from '../helpers/database';
import { factories } from '../helpers/factories';
import {
  createJoinLink,
  getJoinLinkStatus,
  listJoinLinks,
  registerDriver,
} from '../../src/server/services/driver-join';
import { createInvite, getInviteStatus } from '../../src/server/services/auth';
import { saveMaster } from '../../src/server/services/admin';
import { createUse, getUse, listUses, submitUse } from '../../src/server/services/uses';
import { getLookups } from '../../src/server/services/lookups';
import { lookupRate } from '../../src/server/services/rates';
import { counterparties, users } from '../../src/server/db/schema';
import { todaySeoul } from '../../src/server/context';

const database = testDatabase();
const tokenOf = (url: string) => new URL(url).pathname.split('/').at(-1)!;
let serial = 0;
function registration() {
  const n = String(++serial).padStart(4, '0');
  return {
    client_request_id: randomUUID(),
    login_id: randomUUID(),
    password: 'password1234',
    profile: {
      name: `소속 기사${n}`,
      phone: `0108877${n}`,
      plate_no: `서울88아${n}`,
      vehicle_type: '카고',
      tonnage: '8',
    },
  };
}
async function scenario() {
  const f = factories(database().db);
  const admin = await f.user();
  const project = await f.project();
  const party = await f.counterparty({ name: '성호 운수', biz_no: '104-12-34501' });
  return { f, ctx: f.context(admin), admin, project, party };
}
it('새 현장 DB 기본값과 API 기본값은 증빙 선택이고 기존 정책은 유지한다', async () => {
  const s = await scenario();
  const old = await s.f.project({ evidence_policy: 'PHOTO_REQUIRED' });
  const row = (
    await database().pool.query('INSERT INTO projects(code,name) VALUES($1,$2) RETURNING evidence_policy', [
      randomUUID(),
      '새 현장',
    ])
  ).rows[0];
  expect(row.evidence_policy).toBe('NONE');
  expect(await saveMaster(s.ctx, 'projects', { name: '기본 증빙 현장' })).toMatchObject({
    evidence_policy: 'NONE',
  });
  expect(
    (await database().pool.query('SELECT evidence_policy FROM projects WHERE id=$1', [old.id])).rows[0]
      .evidence_policy,
  ).toBe('PHOTO_REQUIRED');
});
it('지정 링크로 여러 기사 가입·1년 전 소속·단가 조회·사진 없는 제출·기사별 운행과 금액 격리·감사', async () => {
  const s = await scenario();
  await s.f.rate(s.party.id);
  const link = await createJoinLink(s.ctx, { project_ids: [s.project.id], counterparty_id: s.party.id });
  const token = tokenOf(link.join_url);
  expect(await getJoinLinkStatus(database().db, token)).toMatchObject({
    business: { name: '성호 운수', masked_biz_no: '104-**-***01' },
  });
  const firstInput = registration();
  const registered = await Promise.all(
    [firstInput, registration()].map((input) => registerDriver(database().db, randomUUID(), token, input)),
  );
  const uses = [];
  for (const result of registered) {
    const [user] = await database().db.select().from(users).where(eq(users.id, result.user.id));
    const ctx = s.f.context(user);
    const lookups = await getLookups(ctx);
    expect(lookups.drivers.map((d) => d.id)).toEqual([user.driver_id]);
    expect(lookups.counterparties.map((p) => p.id)).toEqual([s.party.id]);
    const vehicle = lookups.vehicles[0];
    const rate = await lookupRate(ctx, {
      project_id: s.project.id,
      vehicle_id: vehicle.id,
      counterparty_id: s.party.id,
      use_date: todaySeoul(),
    });
    expect(JSON.stringify(rate)).toContain('300000');
    const use = await createUse(ctx, {
      project_id: s.project.id,
      driver_id: user.driver_id!,
      vehicle_id: vehicle.id,
      use_date: todaySeoul(),
      reviewer_user_id: s.admin.id,
      load_tonnage: '8',
      billing_unit: 'PER_DAY',
      quantity: '1',
      trips: [{ seq: 1, origin: '상차장', destination: '현장' }],
    });
    expect(use.charge_lines[0].computed_amount).toBe(300000);
    await submitUse(ctx, use.id, { version: use.version });
    uses.push({ ctx, use });
  }
  for (const own of uses) {
    const other = uses.find((u) => u !== own)!;
    await expect(getUse(own.ctx, other.use.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await listUses(own.ctx)).rows.map((u) => u.id)).toEqual([own.use.id]);
  }
  const affiliations = (
    await database().pool.query(
      "SELECT valid_from::text, (CURRENT_DATE - interval '1 year')::date::text AS expected FROM driver_affiliations WHERE counterparty_id=$1",
      [s.party.id],
    )
  ).rows;
  expect(affiliations).toHaveLength(2);
  expect(affiliations.every((a) => a.valid_from === a.expected)).toBe(true);
  expect((await registerDriver(database().db, randomUUID(), token, firstInput)).user.id).toBe(
    registered[0].user.id,
  );
  expect((await listJoinLinks(s.ctx)).find((l) => l.id === link.id)).toMatchObject({
    counterparty_id: s.party.id,
    business_name: '성호 운수',
    used_count: 2,
  });
  const audits = (
    await database().pool.query('SELECT action, after FROM audit_logs WHERE entity_id = ANY($1::uuid[])', [
      [link.id, ...registered.map((r) => r.user.id)],
    ])
  ).rows;
  expect(audits.filter((a) => a.action === 'CREATE_JOIN_LINK')).toHaveLength(1);
  expect(
    audits.filter((a) => a.action === 'REGISTER_DRIVER').every((a) => a.after.counterparty_id === s.party.id),
  ).toBe(true);
  expect(audits.filter((a) => a.action === 'REGISTER_DRIVER')).toHaveLength(2);
  expect(JSON.stringify(audits)).not.toContain(token);
});
it('관리자만 지정 가능·잘못된 종류와 비활성 거부·가입 직전 중지 거부·미지정 중복 거부 유지', async () => {
  const s = await scenario();
  for (const role of ['DRIVER', 'SITE_MANAGER', 'SETTLEMENT_MANAGER'] as const) {
    const user = await s.f.user({
      role,
      ...(role === 'DRIVER' ? { driver_id: (await s.f.driver()).id } : {}),
    });
    await expect(
      createJoinLink(s.f.context(user), { project_ids: [s.project.id], counterparty_id: s.party.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  }
  for (const overrides of [{ active: false }, { kind: 'CUSTOMER' as const }]) {
    const party = await s.f.counterparty(overrides);
    await expect(
      createJoinLink(s.ctx, { project_ids: [s.project.id], counterparty_id: party.id }),
    ).rejects.toThrow('사업자');
  }
  const link = await createJoinLink(s.ctx, { project_ids: [s.project.id], counterparty_id: s.party.id });
  const input = registration();
  await expect(
    registerDriver(database().db, randomUUID(), tokenOf(link.join_url), {
      ...input,
      profile: { ...input.profile, business_name: '탈취', biz_no: '999-99-99999' },
    }),
  ).rejects.toThrow();
  await database().db.update(counterparties).set({ active: false }).where(eq(counterparties.id, s.party.id));
  expect(await getJoinLinkStatus(database().db, tokenOf(link.join_url))).toBeNull();
  await expect(
    registerDriver(database().db, randomUUID(), tokenOf(link.join_url), registration()),
  ).rejects.toThrow('사업자');
  const plain = await createJoinLink(s.ctx, { project_ids: [s.project.id] });
  await expect(
    registerDriver(database().db, randomUUID(), tokenOf(plain.join_url), {
      ...input,
      profile: { ...input.profile, business_name: s.party.name, biz_no: s.party.biz_no },
    }),
  ).rejects.toThrow('이미 등록된 사업자번호');
});
it('새 사업자와 링크 원자적 생성·중복 방지·개별 초대 지정 가입은 1회만', async () => {
  const s = await scenario();
  const new_business = { name: '신규 운송', biz_no: '104-33-77881' };
  const link = await createJoinLink(s.ctx, { project_ids: [s.project.id], new_business });
  expect((await listJoinLinks(s.ctx)).find((l) => l.id === link.id)).toMatchObject({
    business_name: new_business.name,
  });
  await expect(createJoinLink(s.ctx, { project_ids: [s.project.id], new_business })).rejects.toThrow(
    '이미 등록',
  );
  await expect(
    createJoinLink(s.ctx, {
      project_ids: [randomUUID()],
      new_business: { name: '롤백', biz_no: '111-22-33344' },
    }),
  ).rejects.toThrow();
  expect(
    (await database().pool.query("SELECT id FROM counterparties WHERE biz_no='111-22-33344'")).rows,
  ).toHaveLength(0);
  const inviteInput = {
    role: 'DRIVER' as const,
    name: '개별 기사',
    project_ids: [s.project.id],
    counterparty_id: s.party.id,
  };
  const invite = await createInvite(s.ctx, inviteInput);
  const token = tokenOf(invite.invite_url);
  expect(await getInviteStatus(database().db, token)).toMatchObject({ business: { name: s.party.name } });
  await registerDriver(database().db, randomUUID(), token, registration(), true);
  await expect(
    registerDriver(database().db, randomUUID(), token, registration(), true),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

it('개별 초대도 새 사업자 생성·감사·비활성 거부·역할 제한을 동일하게 적용한다', async () => {
  const s = await scenario();
  const input = { role: 'DRIVER' as const, name: '신규 소속 기사', project_ids: [s.project.id] };
  const invite = await createInvite(s.ctx, {
    ...input,
    new_business: { name: '초대 운송', biz_no: '104-33-77882' },
  });
  expect(invite.counterparty_id).toBeTruthy();
  const joined = await registerDriver(
    database().db,
    randomUUID(),
    tokenOf(invite.invite_url),
    registration(),
    true,
  );
  expect(
    (
      await database().pool.query('SELECT counterparty_id FROM driver_affiliations WHERE driver_id=$1', [
        joined.user.driver_id,
      ])
    ).rows,
  ).toEqual([{ counterparty_id: invite.counterparty_id }]);
  expect(
    (
      await database().pool.query('SELECT action FROM audit_logs WHERE entity_id=$1', [
        invite.counterparty_id,
      ])
    ).rows,
  ).toEqual([{ action: 'CREATE' }]);
  const manager = await s.f.user({ role: 'SETTLEMENT_MANAGER' });
  await expect(
    createInvite(s.f.context(manager), { ...input, counterparty_id: s.party.id }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(createInvite(s.ctx, { ...input, role: 'ADMIN', counterparty_id: s.party.id })).rejects.toThrow(
    '기사 연결 없는',
  );
  await expect(
    createInvite(s.ctx, { ...input, driver_id: (await s.f.driver()).id, counterparty_id: s.party.id }),
  ).rejects.toThrow('기사 연결 없는');
  const stopped = await createInvite(s.ctx, { ...input, counterparty_id: s.party.id });
  await database().db.update(counterparties).set({ active: false }).where(eq(counterparties.id, s.party.id));
  expect(await getInviteStatus(database().db, tokenOf(stopped.invite_url))).toMatchObject({
    status: 'INVALID',
  });
  await expect(
    registerDriver(database().db, randomUUID(), tokenOf(stopped.invite_url), registration(), true),
  ).rejects.toThrow('사업자');
  await expect(createInvite(s.ctx, { ...input, counterparty_id: s.party.id })).rejects.toThrow('사업자');
});

it('지정된 ID를 우선하며 사업자번호 없는 운송사도 가입, 새 사업자 링크 저장 실패는 원장·감사 롤백', async () => {
  const s = await scenario();
  const party = await s.f.counterparty({ name: '번호 미등록 운송사', biz_no: null });
  const link = await createJoinLink(s.ctx, { project_ids: [s.project.id], counterparty_id: party.id });
  const joined = await registerDriver(database().db, randomUUID(), tokenOf(link.join_url), registration());
  expect(
    (
      await database().pool.query('SELECT counterparty_id FROM driver_affiliations WHERE driver_id=$1', [
        joined.user.driver_id,
      ])
    ).rows,
  ).toEqual([{ counterparty_id: party.id }]);
  await database().pool.query(
    "CREATE FUNCTION f4_fail_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '링크 저장 실패'; END $$; CREATE TRIGGER f4_fail_link BEFORE INSERT ON driver_join_links FOR EACH ROW EXECUTE FUNCTION f4_fail_link()",
  );
  const before = (await database().pool.query('SELECT count(*) FROM audit_logs')).rows;
  try {
    await expect(
      createJoinLink(s.ctx, {
        project_ids: [s.project.id],
        new_business: { name: '실패 사업자', biz_no: '104-33-77883' },
      }),
    ).rejects.toThrow();
    expect(
      (await database().pool.query("SELECT id FROM counterparties WHERE biz_no='104-33-77883'")).rows,
    ).toHaveLength(0);
    expect((await database().pool.query('SELECT count(*) FROM audit_logs')).rows).toEqual(before);
  } finally {
    await database().pool.query(
      'DROP TRIGGER f4_fail_link ON driver_join_links; DROP FUNCTION f4_fail_link()',
    );
  }
});
