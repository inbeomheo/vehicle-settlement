import { callRoute } from '../helpers/routes';
import { GET as reportRoute } from '../../src/app/api/uses/[id]/report.pdf/route';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { projectAssignments, users, auditLogs } from '../../src/server/db/schema';
import { createUse, submitUse, updateUse, requestFix, approveUse } from '../../src/server/services/uses';
import { getUseReviewers } from '../../src/server/services/use-reviewers';
import { getDashboard } from '../../src/server/services/dashboard';
import { getLedger } from '../../src/server/services/ledger';
import { saveFormSettings } from '../../src/server/services/form-settings';
import { exportUseReport } from '../../src/server/services/use-report';
import { uploadImport, previewImport, commitImport } from '../../src/server/services/import';
const database = testDatabase();
const fixture = () => setupScenario(database().db);

describe('FLOW 담당자·적재용량', () => {
  it('활성 담당자의 현재 현장 검수 권한만 제공하며 역할·배정·계정 회수를 거부한다', async () => {
    const s = await fixture();
    const manager = await s.f.user({ role: 'SITE_MANAGER', name: '윤찬식' });
    const assignment = await s.f.assignment(manager.id, s.project.id);
    const other = await s.f.user({ role: 'SITE_MANAGER' });
    const all = await s.f.user({ role: 'SETTLEMENT_MANAGER', all_projects: true });
    const options = await getUseReviewers(s.driverCtx, { project_id: s.project.id });
    expect(options.reviewers.map((row) => row.id)).toEqual(
      expect.arrayContaining([manager.id, s.admin.id, all.id]),
    );
    expect(options.reviewers.map((row) => row.id)).not.toContain(other.id);
    for (const id of [other.id, s.driverUser.id, randomUUID()])
      await expect(createUse(s.driverCtx, { ...s.input, reviewer_user_id: id })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    const use = await createUse(s.driverCtx, {
      ...s.input,
      reviewer_user_id: manager.id,
      load_tonnage: '2.5',
    });
    expect(use.snapshot).toMatchObject({ reviewer_name: '윤찬식', load_tonnage: '2.5' });
    expect((await getUseReviewers(s.driverCtx, { project_id: s.project.id })).default_reviewer_id).toBe(
      manager.id,
    );
    await database()
      .db.update(projectAssignments)
      .set({ revoked_at: new Date() })
      .where(eq(projectAssignments.id, assignment.id));
    await expect(submitUse(s.driverCtx, use.id, { version: use.version })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await database().db.update(users).set({ status: 'DISABLED' }).where(eq(users.id, all.id));
    await expect(createUse(s.driverCtx, { ...s.input, reviewer_user_id: all.id })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(
      getUseReviewers(s.driverCtx, { project_id: s.project.id, driver_id: randomUUID() }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('적재용량은 양수·최대 소수 세 자리이며 기본 필수는 제출 시 적용한다', async () => {
    const s = await fixture();
    for (const value of ['0', '-1', '1.2345', '10000000', 'NaN', 'abc'])
      await expect(createUse(s.driverCtx, { ...s.input, load_tonnage: value })).rejects.toThrow();
    const draft = await createUse(s.driverCtx, { ...s.input, reviewer_user_id: null, load_tonnage: null });
    await expect(submitUse(s.driverCtx, draft.id, { version: draft.version })).rejects.toMatchObject({
      code: 'SUBMIT_BLOCKED',
      details: {
        fields: expect.arrayContaining([
          { target: 'reviewer', reason: expect.any(String) },
          { target: 'load_tonnage', reason: expect.any(String) },
        ]),
      },
    });
    const updated = await updateUse(s.driverCtx, draft.id, {
      version: draft.version,
      reviewer_user_id: s.admin.id,
      load_tonnage: '1.234',
    });
    const submitted = await submitUse(s.driverCtx, draft.id, { version: updated.version });
    expect(submitted.revisions[0].snapshot).toMatchObject({
      reviewer_user_id: s.admin.id,
      load_tonnage: '1.234',
    });
  });
  it('보완 대상·숨김 설정·승인 후 개정·감사 이력에 보존한다', async () => {
    const s = await fixture();
    let use = await createUse(s.driverCtx, s.input);
    use = await submitUse(s.driverCtx, use.id, { version: use.version });
    use = await requestFix(s.adminCtx, use.id, {
      version: use.version,
      fix_items: [
        { target: 'reviewer', message: '담당자를 확인하세요' },
        { target: 'load_tonnage', message: '톤수를 확인하세요' },
      ],
    });
    use = await updateUse(s.driverCtx, use.id, { version: use.version, load_tonnage: '3.5' });
    use = await submitUse(s.driverCtx, use.id, { version: use.version });
    use = await approveUse(s.adminCtx, use.id, { version: use.version });
    use = await updateUse(s.driverCtx, use.id, { version: use.version, load_tonnage: '4.5' });
    expect(use.review_status).toBe('DRAFT');
    expect(
      use.revisions.some((row) => (row.snapshot as { load_tonnage?: string }).load_tonnage === '3.500'),
    ).toBe(true);
    expect(
      (await database().db.select().from(auditLogs).where(eq(auditLogs.entity_id, use.id))).some((row) =>
        JSON.stringify(row.after).includes('4.500'),
      ),
    ).toBe(true);
    await saveFormSettings(s.adminCtx, {
      project_id: s.project.id,
      fields: [
        { field_key: 'reviewer', driver_mode: 'HIDDEN', manager_mode: 'OPTIONAL', version: 0 },
        { field_key: 'load_tonnage', driver_mode: 'OPTIONAL', manager_mode: 'OPTIONAL', version: 0 },
      ],
    });
    use = await submitUse(s.driverCtx, use.id, { version: use.version });
    await expect(
      requestFix(s.adminCtx, use.id, {
        version: use.version,
        fix_items: [{ target: 'reviewer', message: '수정' }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
  it('배지·내 담당은 본인+미지정만, 전체는 다른 담당자도 승인할 수 있다', async () => {
    const s = await fixture();
    const manager = await s.f.user({ role: 'SITE_MANAGER' });
    await s.f.assignment(manager.id, s.project.id);
    await saveFormSettings(s.adminCtx, {
      project_id: s.project.id,
      fields: [{ field_key: 'reviewer', driver_mode: 'OPTIONAL', manager_mode: 'OPTIONAL', version: 0 }],
    });
    for (const reviewer of [s.admin.id, manager.id, null]) {
      const use = await createUse(s.driverCtx, { ...s.input, reviewer_user_id: reviewer });
      await submitUse(s.driverCtx, use.id, { version: use.version });
    }
    const ctx = s.f.context(manager);
    expect((await getDashboard(ctx)).review_pending).toBe(2);
    expect((await getLedger(ctx, { reviewer_scope: 'mine', review_status: 'SUBMITTED' })).total).toBe(2);
    const all = await getLedger(ctx, { reviewer_scope: 'all', review_status: 'SUBMITTED' });
    expect(all.total).toBe(3);
    const other = all.rows.find((row) => row.reviewer_user_id === s.admin.id)!;
    const approved = await approveUse(ctx, other.id, { version: 2 });
    expect(approved.review_status).toBe('APPROVED');
    const { token } = await s.f.session(s.driverUser.id);
    const response = await callRoute(database().db, reportRoute, {
      token,
      path: `/api/uses/${approved.id}/report.pdf`,
      params: { id: approved.id },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
    expect(bytes.toString('latin1')).toContain('NotoSansKR');
    expect(bytes.toString('latin1')).toContain('/ToUnicode');
    expect(bytes.toString('latin1')).toMatch(/\/Type \/Pages\s+\/Count 1/);
    writeFileSync('/tmp/flow-report.pdf', bytes);
    const outsider = await s.f.user({ role: 'SITE_MANAGER' });
    await expect(exportUseReport(s.f.context(outsider), approved.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
  it('가져오기 선택 열을 검증·저장하고 기존 파일 중복 규칙을 유지한다', async () => {
    const s = await fixture();
    const csv = `사용일,현장,기사,차량번호,운송사,출발지,도착지,과금단위,담당자,적재용량\n2026-09-15,${s.project.id},${s.driver.id},${s.vehicle.plate_no},${s.payee.id},출발,도착,일대,${s.admin.id},2.5`;
    const job = await uploadImport(s.adminCtx, 'FLOW.csv', Buffer.from(csv));
    const preview = await previewImport(s.adminCtx, job.id, {
      sheet: 0,
      header_row: 1,
      mapping: job.sheets[0].mapping,
    });
    expect(preview.summary?.valid).toBe(1);
    const saved = await commitImport(s.adminCtx, job.id);
    expect(saved.summary?.success).toBe(1);
    const ledger = await getLedger(s.adminCtx, { project_id: s.project.id });
    expect(ledger.rows[0]).toMatchObject({ reviewer_user_id: s.admin.id, load_tonnage: '2.5' });
  });
});
