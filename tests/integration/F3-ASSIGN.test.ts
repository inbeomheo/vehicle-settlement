import { expect, it } from 'vitest';
import { testDatabase } from '../helpers/database';
import { factories } from '../helpers/factories';
import { addAssignment, revokeAssignment, saveMaster } from '../../src/server/services/admin';
import { createInvite } from '../../src/server/services/auth';
import { createJoinLink } from '../../src/server/services/driver-join';
import { getSetupStatus } from '../../src/server/services/setup-status';
import { getLookups } from '../../src/server/services/lookups';
import { getDriverProfile } from '../../src/server/services/driver-profiles';
import { todaySeoul } from '../../src/server/context';

const database = testDatabase();
async function scenario() {
  const f = factories(database().db);
  const admin = f.context(await f.user());
  const driver = await f.driver();
  const user = await f.user({ role: 'DRIVER', driver_id: driver.id });
  return { f, admin, user, driver: f.context(user) };
}
it('기사 개별 초대는 연결 유무와 관계없이 현장이 하나 이상 필요하다', async () => {
  const s = await scenario();
  const unattached = await s.f.driver();
  for (const driver_id of [undefined, unattached.id]) {
    for (const project_ids of [undefined, []]) {
      await expect(
        createInvite(s.admin, { role: 'DRIVER', name: '초대', driver_id, project_ids }),
      ).rejects.toThrow('현장을 하나 이상');
    }
  }
  const project = await s.f.project();
  expect(
    await createInvite(s.admin, { role: 'DRIVER', name: '초대', project_ids: [project.id] }),
  ).toMatchObject({ project_ids: [project.id] });
  await expect(createJoinLink(s.admin, { project_ids: [] })).rejects.toThrow();
  expect(await createInvite(s.admin, { role: 'ADMIN', name: '관리자' })).toMatchObject({ project_ids: [] });
});
it('현장 생성과 활성 기사 전원 배정·감사가 한 트랜잭션이며 선택 해제와 수정은 배정하지 않는다', async () => {
  const s = await scenario();
  await s.f.user({ role: 'DRIVER', status: 'DISABLED', driver_id: (await s.f.driver()).id });
  await s.f.user({ role: 'SITE_MANAGER' });
  const active = await database().pool.query("SELECT id FROM users WHERE role='DRIVER' AND status='ACTIVE'");
  const project = await saveMaster(s.admin, 'projects', {
    name: '자동 배정',
    evidence_policy: 'NONE',
    assign_all_drivers: true,
  });
  expect(project.assigned_driver_count).toBe(active.rowCount);
  const assignments = await database().pool.query('SELECT * FROM project_assignments WHERE project_id=$1', [
    project.id,
  ]);
  expect(assignments.rows.map((r) => r.user_id).sort()).toEqual(active.rows.map((r) => r.id).sort());
  expect(assignments.rows.every((r) => r.revoked_at === null)).toBe(true);
  const audits = await database().pool.query(
    "SELECT * FROM audit_logs WHERE action='ASSIGN_PROJECT' AND after->>'project_id'=$1",
    [project.id],
  );
  expect(audits.rowCount).toBe(active.rowCount);
  expect(audits.rows.every((r) => r.user_id === s.admin.user.id)).toBe(true);
  const skipped = await saveMaster(s.admin, 'projects', {
    name: '배정 안 함',
    evidence_policy: 'NONE',
    assign_all_drivers: false,
  });
  expect(skipped.assigned_driver_count).toBe(0);
  await saveMaster(s.admin, 'projects', { name: '수정' }, String(skipped.id));
  expect(
    (await database().pool.query('SELECT * FROM project_assignments WHERE project_id=$1', [skipped.id]))
      .rowCount,
  ).toBe(0);
  const beforeRollback = await database().pool.query('SELECT count(*)::int AS count FROM audit_logs');
  await expect(
    database().db.transaction(async (db) => {
      await saveMaster({ ...s.admin, db }, 'projects', {
        code: 'rollback-assign',
        name: '롤백',
        evidence_policy: 'NONE',
        assign_all_drivers: true,
      });
      throw new Error('rollback');
    }),
  ).rejects.toThrow('rollback');
  expect((await database().pool.query("SELECT * FROM projects WHERE code='rollback-assign'")).rowCount).toBe(
    0,
  );
  expect((await database().pool.query('SELECT count(*)::int AS count FROM audit_logs')).rows).toEqual(
    beforeRollback.rows,
  );
  await expect(
    saveMaster(s.admin, 'projects', {
      name: '중지 현장',
      active: false,
      evidence_policy: 'NONE',
      assign_all_drivers: true,
    }),
  ).rejects.toThrow('사용 중');
  const omitted = await saveMaster(s.admin, 'projects', { name: '기존 API 호출', evidence_policy: 'NONE' });
  expect(omitted.assigned_driver_count).toBe(0);
});
it('배정 없는 기사 안내 데이터는 현재 유효한 활성 현장만 세며 추가·회수는 관리자 권한과 감사를 유지한다', async () => {
  const s = await scenario();
  const project = await s.f.project();
  await s.f.assignment(s.user.id, (await s.f.project({ active: false })).id);
  await s.f.assignment(s.user.id, project.id, { valid_from: '2099-01-01' });
  await s.f.assignment(s.user.id, project.id, { valid_to: '2020-12-31' });
  const baseline = (await getSetupStatus(s.admin)).unassigned_drivers;
  expect(baseline).toBeGreaterThan(0);
  await s.f.user({ role: 'DRIVER', status: 'DISABLED', driver_id: (await s.f.driver()).id });
  expect((await getSetupStatus(s.admin)).unassigned_drivers).toBe(baseline);
  expect((await getLookups(s.driver)).projects).toEqual([]);
  expect((await getDriverProfile(s.admin, s.user.id)).projects).toEqual([]);
  const input = {
    user_id: s.user.id,
    project_id: project.id,
    valid_from: todaySeoul(),
    valid_to: '2098-12-31',
  };
  const assignment = await addAssignment(s.admin, input);
  for (const role of ['DRIVER', 'SITE_MANAGER', 'SETTLEMENT_MANAGER'] as const) {
    const ctx = role === 'DRIVER' ? s.driver : s.f.context(await s.f.user({ role }));
    await expect(addAssignment(ctx, input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(revokeAssignment(ctx, assignment.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  }
  expect((await getSetupStatus(s.admin)).unassigned_drivers).toBe(baseline - 1);
  expect((await getLookups(s.driver)).projects.map((p) => p.id)).toEqual([project.id]);
  await expect(revokeAssignment(s.driver, assignment.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await revokeAssignment(s.admin, assignment.id);
  expect((await getSetupStatus(s.admin)).unassigned_drivers).toBe(baseline);
  expect((await getLookups(s.driver)).projects).toEqual([]);
  const audits = await database().pool.query('SELECT action FROM audit_logs WHERE entity_id=$1 ORDER BY at', [
    assignment.id,
  ]);
  expect(audits.rows.map((r) => r.action)).toEqual(['ASSIGN_PROJECT', 'REVOKE_PROJECT']);
});
