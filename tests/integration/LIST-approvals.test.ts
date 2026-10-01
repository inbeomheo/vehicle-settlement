import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { callRoute } from '../helpers/routes';
import { getApprovals } from '../../src/server/services/approvals';
import { exportApprovals } from '../../src/server/services/approvals-export';
import { createUse, submitUse, approveUse, requestFix, cancelUse } from '../../src/server/services/uses';
import { projectAssignments, rateAgreements, vehicleUses } from '../../src/server/db/schema';
import { GET } from '../../src/app/api/approvals/route';
import { GET as exportGET } from '../../src/app/api/approvals/export.xlsx/route';
import { quickApprovable } from '../../src/components/manager/quick-approval';
import type { LedgerRow } from '../../src/server/services/ledger';
const database = testDatabase();
async function scenario() {
  const s = await setupScenario(database().db);
  const manager = await s.f.user({ role: 'SITE_MANAGER', name: 'LIST 담당자' });
  const assignment = await s.f.assignment(manager.id, s.project.id);
  return {
    ...s,
    manager,
    managerCtx: s.f.context(manager),
    managerAssignment: assignment,
    query: { from: '2026-09-15', to: '2026-09-15', project_id: s.project.id },
  };
}
it('다섯 탭은 취소를 전체에만 포함하며 개수·공급가 합계·페이지를 구분한다', async () => {
  const s = await scenario();
  for (const status of ['DRAFT', 'SUBMITTED', 'NEEDS_FIX', 'APPROVED', 'CANCELED']) {
    let use = await createUse(s.adminCtx, { ...s.input, quantity: '1' });
    if (status === 'CANCELED') {
      await cancelUse(s.adminCtx, use.id, { version: use.version, reason: '중복 입력' });
      continue;
    }
    if (status === 'DRAFT') continue;
    use = await submitUse(s.adminCtx, use.id, { version: use.version });
    if (status === 'APPROVED') await approveUse(s.adminCtx, use.id, { version: use.version });
    if (status === 'NEEDS_FIX')
      await requestFix(s.adminCtx, use.id, {
        version: use.version,
        comment: '경로 확인',
        fix_items: [{ target: 'trip:1.destination', message: '도착지 확인' }],
      });
  }
  const all = await getApprovals(s.managerCtx, { ...s.query, pageSize: 2 });
  expect(all.total).toBe(5);
  expect(all.rows).toHaveLength(2);
  expect(all.counts).toEqual({ ALL: 5, DRAFT: 1, SUBMITTED: 1, NEEDS_FIX: 1, APPROVED: 1 });
  expect(all.summary).toEqual({ count: 4, amount: 1200000, unknown_count: 0 });
  for (const review_status of ['DRAFT', 'SUBMITTED', 'NEEDS_FIX', 'APPROVED']) {
    const data = await getApprovals(s.managerCtx, { ...s.query, review_status });
    expect(data.total).toBe(1);
    expect(data.rows[0].review_status).toBe(review_status);
    expect(data.counts).toEqual(all.counts);
    expect(data.summary.count).toBe(1);
  }
});
it('날짜·경로·회차 운반내용·프로젝트·기사·담당자와 나 필터를 동일하게 적용하고 엑셀은 전체 페이지를 출력한다', async () => {
  const s = await scenario();
  const otherReviewer = await s.f.user({ name: '다른 담당자' });
  for (const [index, day] of ['2026-09-15', '2026-09-16', '2026-09-16'].entries()) {
    const use = await createUse(s.adminCtx, {
      ...s.input,
      use_date: day,
      quantity: '1',
      trips: [{ seq: 1, origin: '탕정', destination: '용인', cargo_desc: '배관 100%' }],
      cargo_desc: '자재 운반',
    });
    await database()
      .db.update(vehicleUses)
      .set({ reviewer_user_id: index === 0 ? otherReviewer.id : s.manager.id })
      .where(eq(vehicleUses.id, use.id));
  }
  const query = {
    ...s.query,
    to: '2026-09-16',
    reviewer_user_id: 'me',
    driver_id: s.driver.id,
    transport_search: '배관 100%',
  };
  const result = await getApprovals(s.managerCtx, { ...query, pageSize: 1 });
  expect(result.total).toBe(2);
  expect(result.rows[0].use_date).toBe('2026-09-16');
  expect(result.counts.DRAFT).toBe(2);
  expect((await getApprovals(s.managerCtx, { ...query, transport_search: '탕정' })).total).toBe(2);
  expect((await getApprovals(s.managerCtx, { ...query, transport_search: '자재' })).total).toBe(2);
  expect((await getApprovals(s.managerCtx, { ...query, reviewer_user_id: otherReviewer.id })).total).toBe(1);
  expect((await getApprovals(s.managerCtx, { ...query, driver_id: crypto.randomUUID() })).total).toBe(0);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(
    Buffer.from(await exportApprovals(s.managerCtx, { ...query, pageSize: 1, page: 2 })) as never,
  );
  expect(book.worksheets[0].rowCount).toBe(4);
  expect(book.worksheets[0].getCell('H4').value).toBe(600000);
  expect(book.worksheets[0].getCell('G2').value).toBe(s.manager.name);
});
it('현장 접근·본인 기사·필터 선택지·배정 회수와 엑셀 권한은 서버가 강제한다', async () => {
  const s = await scenario();
  await createUse(s.driverCtx, { ...s.input, quantity: '1' });
  const other = await s.f.driver({ name: '다른 기사' });
  await s.f.affiliation(other.id, s.payee.id);
  await createUse(s.adminCtx, { ...s.input, driver_id: other.id, quantity: '1' });
  const hidden = await s.f.project({ name: '비공개 현장' });
  await createUse(s.adminCtx, { ...s.input, project_id: hidden.id, quantity: '1' });
  const manager = await getApprovals(s.managerCtx, { from: s.query.from, to: s.query.to });
  expect(manager.total).toBe(2);
  expect(manager.options.projects.map((p) => p.id)).toEqual([s.project.id]);
  const driver = await getApprovals(s.driverCtx, s.query);
  expect(driver.total).toBe(1);
  expect(driver.counts.ALL).toBe(1);
  expect(driver.options.drivers).toEqual([]);
  expect(JSON.stringify(driver)).not.toContain('receivable_amount');
  expect((await getApprovals(s.driverCtx, { ...s.query, driver_id: other.id })).total).toBe(0);
  expect((await getApprovals(s.managerCtx, { ...s.query, project_id: hidden.id })).total).toBe(0);
  await database()
    .db.update(projectAssignments)
    .set({ revoked_at: new Date() })
    .where(eq(projectAssignments.id, s.managerAssignment.id));
  expect((await getApprovals(s.managerCtx, s.query)).counts.ALL).toBe(0);
  await expect(exportApprovals(s.driverCtx, s.query)).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
it('바로 승인 가능 여부는 검수함과 같으며 잘못된 API 입력·미인증·기사 엑셀을 거부한다', async () => {
  const s = await scenario();
  for (const requested_amount of [300000, 400000]) {
    let use = await createUse(s.adminCtx, {
      ...s.input,
      quantity: '1',
      charge_lines: [{ charge_type: 'BASE', quantity: '1', requested_amount }],
    });
    use = await submitUse(s.adminCtx, use.id, { version: use.version });
  }
  const data = await getApprovals(s.managerCtx, s.query);
  expect((data.rows as LedgerRow[]).filter(quickApprovable)).toHaveLength(1);
  const { token } = await s.f.session(s.driverUser.id);
  for (const query of [
    'from=2026-02-30',
    'from=2026-09-16&to=2026-09-15',
    'reviewer_user_id=bad',
    'page=0',
  ]) {
    const response = await callRoute(database().db, GET, { token, path: `/api/approvals?${query}` });
    expect(response.status).toBe(422);
  }
  expect((await callRoute(database().db, GET)).status).toBe(401);
  expect(
    (await callRoute(database().db, exportGET, { token, path: '/api/approvals/export.xlsx' })).status,
  ).toBe(403);
});

it('0원·미확정·부가세 포함과 고객청구 제외를 공급가 합계에 반영한다', async () => {
  const s = await scenario();
  const customer = await s.f.counterparty({ kind: 'CUSTOMER' });
  await s.f.rate(customer.id, { direction: 'RECEIVABLE', unit_price: 990000 });
  await database()
    .db.update(rateAgreements)
    .set({ tax_mode: 'VAT_INCLUDED' })
    .where(eq(rateAgreements.id, s.rate.id));
  await createUse(s.adminCtx, {
    ...s.input,
    customer_counterparty_id: customer.id,
    charge_lines: [
      { charge_type: 'BASE', quantity: '1', requested_amount: 110000 },
      { charge_type: 'BASE', quantity: '1', direction: 'RECEIVABLE' },
    ],
  });
  await createUse(s.adminCtx, {
    ...s.input,
    charge_lines: [{ charge_type: 'BASE', quantity: '1', requested_amount: 0 }],
  });
  await createUse(s.adminCtx, { ...s.input, billing_unit: 'PER_HOUR' });
  const data = await getApprovals(s.managerCtx, s.query);
  expect(data.summary).toEqual({ count: 3, amount: 100000, unknown_count: 1 });
  const driver = await getApprovals(s.driverCtx, { ...s.query, transport_search: '상차장' });
  expect(driver.summary).toEqual(data.summary);
  expect(driver.total).toBe(3);
  expect(JSON.stringify(driver)).not.toContain('990000');
});
