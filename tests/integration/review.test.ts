import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import {
  approveUse,
  cancelUse,
  confirmByDriver,
  copyUse,
  createUse,
  getUse,
  requestFix,
  reviewChargeLine,
  submitUse,
  updateUse,
} from '../../src/server/services/uses';
import { auditLogs, chargeLines, statements, useRevisions } from '../../src/server/db/schema';
const database = testDatabase();
async function approved() {
  const s = await setupScenario(database().db);
  let use = await createUse(s.adminCtx, s.input);
  use = await submitUse(s.adminCtx, use.id, { version: use.version });
  use = await approveUse(s.adminCtx, use.id, { version: use.version });
  return { ...s, use };
}
it('(g) 기사 비용 수정은 DRAFT, 이전 승인과 revision 보존', async () => {
  const s = await approved();
  let changed = await updateUse(s.driverCtx, s.use.id, {
    version: s.use.version,
    charge_lines: [{ id: s.use.charge_lines[0].id, charge_type: 'BASE', quantity: '2' }],
  });
  expect(changed).toMatchObject({ review_status: 'DRAFT', approved_revision_id: null });
  expect(changed.charge_lines[0]).toMatchObject({
    computed_amount: 600000,
    approved_amount: null,
    line_review_status: 'PENDING',
  });
  const old = await database()
    .db.select()
    .from(useRevisions)
    .where(eq(useRevisions.id, s.use.approved_revision_id!));
  expect(old[0]).toMatchObject({ decision: 'SUPERSEDED', decided_by: s.admin.id });
  expect(old[0].decided_at).not.toBeNull();
  changed = await submitUse(s.driverCtx, changed.id, { version: changed.version });
  changed = await approveUse(s.adminCtx, changed.id, { version: changed.version });
  expect(changed.charge_lines[0].approved_amount).toBe(600000);
  expect(changed.revisions).toHaveLength(2);
  const audit = await database().db.select().from(auditLogs).where(eq(auditLogs.entity_id, changed.id));
  expect(audit.some((a) => a.action === 'UPDATE' && JSON.stringify(a.before).includes('300000'))).toBe(true);
});
it('담당자 내용 수정은 새 revision 자동 SUBMITTED', async () => {
  const s = await approved();
  const changed = await updateUse(s.adminCtx, s.use.id, { version: s.use.version, notes: '수정 사유' });
  expect(changed).toMatchObject({ review_status: 'SUBMITTED', current_revision_no: 2 });
  expect(changed.revisions[0].snapshot.notes).toBe('수정 사유');
  expect(changed.revisions[1].decision).toBe('SUPERSEDED');
});
it('추가비 개별 보류, 승인액 지정과 VAT_INCLUDED 공급가', async () => {
  const s = await setupScenario(database().db);
  await s.f.rate(s.payee.id, { project_id: s.project.id, tax_mode: 'VAT_INCLUDED', unit_price: 330000 });
  let use = await createUse(s.adminCtx, {
    ...s.input,
    charge_lines: [
      { charge_type: 'BASE' },
      { charge_type: 'TOLL', requested_amount: 5000, reason: '통행료' },
      { charge_type: 'WAITING', requested_amount: 10000, reason: '대기 1시간' },
    ],
  });
  use = await submitUse(s.adminCtx, use.id, { version: use.version });
  const toll = use.charge_lines.find((c) => c.charge_type === 'TOLL')!;
  const waiting = use.charge_lines.find((c) => c.charge_type === 'WAITING')!;
  use = await approveUse(s.adminCtx, use.id, {
    version: use.version,
    lines: [
      { id: toll.id, line_review_status: 'HELD', reason: '영수증 확인 중' },
      { id: waiting.id, line_review_status: 'APPROVED', approved_amount: 8000 },
    ],
  });
  expect(use.review_status).toBe('APPROVED');
  expect(use.charge_lines.find((c) => c.charge_type === 'BASE')).toMatchObject({
    approved_amount: 300000,
    tax_amount: 30000,
  });
  expect(use.charge_lines.find((c) => c.id === toll.id)).toMatchObject({
    line_review_status: 'HELD',
    approved_amount: null,
  });
  expect(use.charge_lines.find((c) => c.id === waiting.id)?.approved_amount).toBe(8000);
});
it('보완요청 항목과 재제출, 라인 검수는 제출 상태에서만', async () => {
  const s = await setupScenario(database().db);
  let use = await createUse(s.adminCtx, s.input);
  use = await submitUse(s.adminCtx, use.id, { version: use.version });
  use = await requestFix(s.adminCtx, use.id, {
    version: use.version,
    fix_items: [{ target: 'trip:2.destination', message: '하차 장소를 추가해 주세요' }],
  });
  expect(use.revisions[0].fix_items).toHaveLength(1);
  use = await updateUse(s.driverCtx, use.id, { version: use.version, notes: '보완' });
  use = await submitUse(s.driverCtx, use.id, { version: use.version });
  const line = await reviewChargeLine(s.adminCtx, use.charge_lines[0].id, {
    version: use.version,
    line_review_status: 'HELD',
    reason: '재확인',
  });
  use = await approveUse(s.adminCtx, use.id, { version: line.use_version });
  expect(use.charge_lines[0].line_review_status).toBe('HELD');
  await expect(
    reviewChargeLine(s.adminCtx, line.id, { version: use.version, line_review_status: 'APPROVED' }),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
});
it('확정 명세 잠금이 있으면 수정·취소 모두 차단', async () => {
  const s = await approved();
  const [statement] = await database()
    .db.insert(statements)
    .values({
      direction: 'PAYABLE',
      counterparty_id: s.payee.id,
      period_start: '2026-09-01',
      period_end: '2026-09-30',
      created_by: s.admin.id,
    })
    .returning();
  await database()
    .db.update(chargeLines)
    .set({ locked_statement_id: statement.id })
    .where(eq(chargeLines.id, s.use.charge_lines[0].id));
  await expect(
    updateUse(s.driverCtx, s.use.id, { version: s.use.version, notes: '변경' }),
  ).rejects.toMatchObject({ code: 'STATEMENT_LOCKED' });
  await expect(
    cancelUse(s.adminCtx, s.use.id, { version: s.use.version, reason: '취소' }),
  ).rejects.toMatchObject({ code: 'STATEMENT_LOCKED' });
  expect((await getUse(s.adminCtx, s.use.id)).review_status).toBe('APPROVED');
});
it('대리입력 기사 확인·복사·논리 취소', async () => {
  const s = await approved();
  expect(s.use.entered_as).toBe('PROXY');
  const confirmed = await confirmByDriver(s.driverCtx, s.use.id, { version: s.use.version });
  expect(confirmed.driver_confirmed_at).not.toBeNull();
  const copy = await copyUse(s.driverCtx, s.use.id, {
    use_date: '2026-09-16',
    client_request_id: crypto.randomUUID(),
  });
  expect(copy).toMatchObject({
    review_status: 'DRAFT',
    entered_as: 'DRIVER_SELF',
    approved_revision_id: null,
  });
  expect(copy.evidence).toHaveLength(0);
  expect(copy.revisions).toHaveLength(0);
  expect(copy.charge_lines[0].locked_statement_id).toBeNull();
  const canceled = await cancelUse(s.adminCtx, copy.id, { version: copy.version, reason: '중복 입력' });
  expect(canceled.operation_status).toBe('CANCELED');
  expect((await getUse(s.adminCtx, copy.id)).id).toBe(copy.id);
});
it('동시 명세 확정이 비용 잠금을 먼저 잡으면 사용 건 수정은 대기 후 거부', async () => {
  const s = await approved();
  const [statement] = await database()
    .db.insert(statements)
    .values({
      direction: 'PAYABLE',
      counterparty_id: s.payee.id,
      period_start: '2026-09-01',
      period_end: '2026-09-30',
      created_by: s.admin.id,
    })
    .returning();
  let locked!: () => void;
  const lockReady = new Promise<void>((r) => {
    locked = r;
  });
  let finish!: () => void;
  const release = new Promise<void>((r) => {
    finish = r;
  });
  const confirmation = database().db.transaction(async (tx) => {
    await tx.select().from(chargeLines).where(eq(chargeLines.id, s.use.charge_lines[0].id)).for('update');
    locked();
    await release;
    await tx
      .update(chargeLines)
      .set({ locked_statement_id: statement.id })
      .where(eq(chargeLines.id, s.use.charge_lines[0].id));
  });
  await lockReady;
  const mutation = updateUse(s.adminCtx, s.use.id, { version: s.use.version, quantity: '2' });
  const assertion = expect(mutation).rejects.toMatchObject({ code: 'STATEMENT_LOCKED' });
  let waiting = false;
  try {
    for (let i = 0; i < 200; i++) {
      const r = await database().pool.query(
        "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%charge_lines%'",
      );
      if (r.rowCount) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  } finally {
    finish();
  }
  await confirmation;
  await assertion;
  expect(waiting).toBe(true);
  expect((await getUse(s.adminCtx, s.use.id)).charge_lines[0].computed_amount).toBe(300000);
});
