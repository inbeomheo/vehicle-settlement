import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { projects } from '../../src/server/db/schema';
import { updateUse, approveUse } from '../../src/server/services/uses';
import { auditChanges } from '../../src/components/manager/audit';
import { queryAudit } from '../../src/server/services/audit-query';
import { saveFormSettings } from '../../src/server/services/form-settings';
import { audit } from '../../src/server/audit';
import { GET as settingsGET } from '../../src/app/api/form-settings/route';
import { GET as ratesGET } from '../../src/app/api/rates/lookup/route';
import { callRoute } from '../helpers/routes';
import { testDatabase } from '../helpers/database';
import { approved, scenario } from './W4-fixtures';
const database = testDatabase();

it('3. 설정 이력은 변경되지 않은 항목명·현장도 표시하고 승인 제출본 UUID를 차수로 해석한다', async () => {
  const s = await scenario(database().db);
  const project = await s.f.project({ name: '서울 현장' });
  for (const [version, driver_mode] of ['REQUIRED', 'HIDDEN'].entries()) {
    await saveFormSettings(s.adminCtx, {
      project_id: project.id,
      fields: [{ field_key: 'requester', driver_mode, manager_mode: null, version }],
    });
  }
  const result = await queryAudit(s.adminCtx, { entity_type: 'form_field_setting', user_id: s.admin.id });
  const rows = result.rows as { entity_label?: string }[];
  expect(rows).toHaveLength(2);
  expect(rows.every((r) => r.entity_label === '요청자(서울 현장)')).toBe(true);
  await s.adminCtx.db.update(projects).set({ name: '변경된 현장명' }).where(eq(projects.id, project.id));
  const renamed = await queryAudit(s.adminCtx, { entity_type: 'form_field_setting', user_id: s.admin.id });
  expect(renamed.rows.every((row) => row.entity_label === '요청자(서울 현장)')).toBe(true);
  let use = await approved(s);
  for (const notes of ['두 번째 제출', '세 번째 제출']) {
    const submitted = await updateUse(s.adminCtx, use.id, { version: use.version, notes });
    use = await approveUse(s.adminCtx, use.id, { version: submitted.version });
  }
  const history = await queryAudit(s.adminCtx, { use_id: use.id });
  expect(JSON.stringify(history.rows)).toContain('제출본 #1');
  const approval = (history.rows as { action: string; after: { approved_revision_id: string } }[]).find(
    (r) => r.action === 'APPROVE',
  );
  expect(approval?.after.approved_revision_id).toBe('제출본 #3');
  expect(
    auditChanges({ trips: [{ cargo_desc: '모래' }] }, { trips: [{ cargo_desc: '골재' }] })[0].title,
  ).toBe('운행 · 1번째 · 화물');
});

it('10. 기본 조회·건수에서 세션을 제외하며 명시 토글로 포함하되 담당자 권한을 넓히지 않는다', async () => {
  const s = await scenario(database().db);
  await audit(s.adminCtx, 'LOGIN', 'session', crypto.randomUUID());
  await audit(s.adminCtx, 'LOGOUT', 'session', crypto.randomUUID());
  await audit(s.adminCtx, 'CREATE', 'projects', s.project.id);
  const query = { user_id: s.admin.id };
  const normal = await queryAudit(s.adminCtx, query);
  expect(normal.total).toBe(1);
  const expanded = await queryAudit(s.adminCtx, { ...query, include_sessions: 'true' });
  expect(expanded.total).toBe(3);
  expect((await queryAudit(s.adminCtx, { ...query, include_sessions: 'false' })).total).toBe(1);
  const manager = await s.f.user({ role: 'SITE_MANAGER' });
  await s.f.assignment(manager.id, s.project.id);
  expect(
    (await queryAudit(s.f.context(manager), { include_sessions: 'true', entity_type: 'session' })).total,
  ).toBe(0);
});

it('5. 잘못된 현장 URL은 form-settings·rates/lookup에서 현장 경로를 포함한 422로 반환한다', async () => {
  const s = await scenario(database().db);
  const { token } = await s.f.session(s.admin.id);
  for (const [handler, path] of [
    [settingsGET, '/api/form-settings?project_id=__none'],
    [
      ratesGET,
      `/api/rates/lookup?project_id=__none&counterparty_id=${s.payee.id}&vehicle_id=${s.vehicle.id}&use_date=2026-09-15`,
    ],
  ] as const) {
    const response = await callRoute(database().db, handler, { path, token });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: {
        code: 'VALIDATION_FAILED',
        message: '입력 내용을 확인하세요.',
        details: expect.arrayContaining([
          expect.objectContaining({ path: ['project_id'], message: expect.any(String) }),
        ]),
      },
    });
  }
});
