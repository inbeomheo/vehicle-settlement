import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { auditLogs } from '../../src/server/db/schema';
import { approveUse, cancelUse, createUse, getUse, submitUse } from '../../src/server/services/uses';
import { saveFormSettings } from '../../src/server/services/form-settings';
import { confirmStatement, createStatement } from '../../src/server/services/statements';

const database = testDatabase();

it.each(['SUBMITTED', 'APPROVED'] as const)(
  '%s 관리자 취소는 새 필수값 없이 승인만 해제하고 재제출 버전을 만들지 않는다',
  async (status) => {
    const s = await setupScenario(database().db);
    let use = await createUse(s.driverCtx, s.input);
    use = await submitUse(s.driverCtx, use.id, { version: use.version });
    if (status === 'APPROVED') use = await approveUse(s.adminCtx, use.id, { version: use.version });
    await saveFormSettings(s.adminCtx, {
      project_id: s.project.id,
      fields: [{ field_key: 'requester', driver_mode: 'HIDDEN', manager_mode: 'REQUIRED', version: 0 }],
    });
    const canceled = await cancelUse(s.adminCtx, use.id, { version: use.version, reason: '운행 취소' });
    expect(canceled).toMatchObject({
      operation_status: 'CANCELED',
      review_status: 'DRAFT',
      approved_revision_id: null,
      current_revision_no: use.current_revision_no,
      version: use.version + 1,
    });
    expect(canceled.revisions).toHaveLength(use.revisions.length);
    expect(canceled.revisions[0]).toMatchObject({
      id: use.revisions[0].id,
      decision: 'SUPERSEDED',
      snapshot: use.revisions[0].snapshot,
      decided_by: use.revisions[0].decided_by,
    });
    expect(canceled.charge_lines[0]).toMatchObject({
      approved_amount: null,
      tax_amount: null,
      line_review_status: 'PENDING',
      computed_amount: use.charge_lines[0].computed_amount,
    });
    const logs = await database().db.select().from(auditLogs).where(eq(auditLogs.entity_id, use.id));
    expect(logs.filter((log) => log.action === 'CANCEL')).toMatchObject([{ reason: '운행 취소' }]);
  },
);

it('취소는 버전 충돌과 정산 잠금을 유지하며 실패 시 승인·이력을 보존한다', async () => {
  const s = await setupScenario(database().db);
  let use = await createUse(s.driverCtx, s.input);
  use = await submitUse(s.driverCtx, use.id, { version: use.version });
  use = await approveUse(s.adminCtx, use.id, { version: use.version });
  await expect(
    cancelUse(s.adminCtx, use.id, { version: use.version - 1, reason: '취소' }),
  ).rejects.toMatchObject({
    code: 'VERSION_CONFLICT',
    status: 409,
  });
  const statement = await createStatement(s.adminCtx, {
    client_request_id: crypto.randomUUID(),
    direction: 'PAYABLE',
    counterparty_id: s.payee.id,
    period_start: '2026-09-01',
    period_end: '2026-09-30',
    items: [{ charge_line_id: use.charge_lines[0].id }],
  });
  await confirmStatement(s.adminCtx, statement.id, {
    version: statement.version,
    confirmation_token: statement.confirmation_token!,
  });
  const before = await getUse(s.adminCtx, use.id);
  await expect(
    cancelUse(s.adminCtx, use.id, { version: before.version, reason: '취소' }),
  ).rejects.toMatchObject({
    code: 'STATEMENT_LOCKED',
    status: 409,
  });
  expect(await getUse(s.adminCtx, use.id)).toEqual(before);
});
