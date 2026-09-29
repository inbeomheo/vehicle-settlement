import { expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { eq } from 'drizzle-orm';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { callRoute } from '../helpers/routes';
import { createUse, submitUse, approveUse } from '../../src/server/services/uses';
import { getLedger } from '../../src/server/services/ledger';
import { getDashboard } from '../../src/server/services/dashboard';
import { getRecentRoutes } from '../../src/server/services/ledger-recent';
import { queryAudit } from '../../src/server/services/audit-query';
import { GET as ledgerRoute } from '../../src/app/api/ledger/route';
import { GET as exportRoute } from '../../src/app/api/ledger/export.xlsx/route';
import { GET as dashboardRoute } from '../../src/app/api/dashboard/route';
import { GET as auditRoute } from '../../src/app/api/audit/route';
import {
  chargeLines,
  evidence,
  paymentRecords,
  statementItems,
  statements,
} from '../../src/server/db/schema';
const database = testDatabase();
type Scenario = Awaited<ReturnType<typeof setupScenario>>;
async function approved(s: Scenario, quantity = '1', date = '2026-09-15') {
  let use = await createUse(s.adminCtx, {
    ...s.input,
    use_date: date,
    quantity,
    trips: [{ seq: 1, origin: '부산항', destination: '시청', quantity: '2.500', quantity_unit: '톤' }],
  });
  use = await submitUse(s.adminCtx, use.id, { version: use.version });
  return approveUse(s.adminCtx, use.id, { version: use.version });
}
async function statement(
  s: Scenario,
  uses: Awaited<ReturnType<typeof approved>>[],
  total: number,
  period = '2026-10',
) {
  const [row] = await database()
    .db.insert(statements)
    .values({
      direction: 'PAYABLE',
      counterparty_id: s.payee.id,
      period_start: `${period}-01`,
      period_end: `${period}-28`,
      created_by: s.admin.id,
      status: 'CONFIRMED',
      statement_no: `PAY-${crypto.randomUUID()}`,
      supply_total: total,
      tax_total: 0,
      grand_total: total,
    })
    .returning();
  for (const use of uses)
    for (const line of use.charge_lines) {
      await database().db.insert(statementItems).values({
        statement_id: row.id,
        charge_line_id: line.id,
        inclusion: 'INCLUDED',
        supply_amount: line.approved_amount,
        tax_amount: line.tax_amount,
        is_active_lock: true,
      });
      await database()
        .db.update(chargeLines)
        .set({ locked_statement_id: row.id })
        .where(eq(chargeLines.id, line.id));
    }
  return row;
}
it('필터 total/filteredSum과 pageSum을 분리하고 정렬·빈 페이지에도 전체 합계를 유지한다', async () => {
  const s = await setupScenario(database().db);
  const a = await approved(s, '1', '2026-09-01');
  const b = await approved(s, '2', '2026-09-02');
  await approved(s, '3', '2026-08-01');
  const other = await s.f.project();
  await createUse(s.adminCtx, { ...s.input, project_id: other.id });
  const filter = {
    project_id: s.project.id,
    from: '2026-09-01',
    to: '2026-09-30',
    review_status: 'APPROVED',
    search: '부산항',
    pageSize: 1,
    sort: 'total_amount',
    order: 'asc',
  };
  const result = await getLedger(s.adminCtx, filter);
  expect(result.total).toBe(2);
  expect(result.rows[0].id).toBe(a.id);
  expect(result.totals).toEqual({ pageSum: 300000, filteredSum: 900000 });
  const second = await getLedger(s.adminCtx, { ...filter, page: 2 });
  expect(second.rows[0].id).toBe(b.id);
  expect(second.totals.pageSum).toBe(600000);
  const empty = await getLedger(s.adminCtx, { ...filter, page: 3 });
  expect(empty.rows).toHaveLength(0);
  expect(empty.totals).toEqual({ pageSum: 0, filteredSum: 900000 });
  expect((await getLedger(s.adminCtx, { ...filter, search: '없는검색어' })).total).toBe(0);
});
it('엑셀은 같은 필터의 전체 행·전체 열·합계를 API와 일치시킨다', async () => {
  const s = await setupScenario(database().db);
  await approved(s);
  await approved(s, '2');
  await approved(s, '3', '2026-08-01');
  const { token } = await s.f.session(s.admin.id);
  const query = `?project_id=${s.project.id}&from=2026-09-01&pageSize=1`;
  const api = await callRoute(database().db, ledgerRoute, { token, path: `/api/ledger${query}` });
  expect(api.status).toBe(200);
  const data = (await api.json()).data;
  const exported = await callRoute(database().db, exportRoute, {
    token,
    path: `/api/ledger/export.xlsx${query}`,
  });
  expect(exported.status).toBe(200);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await exported.arrayBuffer());
  const sheet = book.worksheets[0];
  expect(sheet.rowCount).toBe(data.total + 2);
  expect(sheet.columnCount).toBe(27);
  expect(sheet.getRow(sheet.rowCount).getCell(18).value).toBe(data.totals.filteredSum);
  const sum = Array.from({ length: data.total }, (_, i) =>
    Number(sheet.getRow(i + 2).getCell(18).value),
  ).reduce((a, b) => a + b, 0);
  expect(sum).toBe(data.totals.filteredSum);
  expect(sheet.getRow(2).getCell(3).value).toBe(s.project.name);
});
it('현장 담당자의 목록·엑셀·변경 이력은 배정 현장만, 기사는 403', async () => {
  const s = await setupScenario(database().db);
  const use = await approved(s);
  const other = await setupScenario(database().db);
  const hidden = await approved(other);
  const manager = await s.f.user({ role: 'SITE_MANAGER' });
  await s.f.assignment(manager.id, s.project.id);
  const ctx = s.f.context(manager);
  const data = await getLedger(ctx, {});
  expect(data.rows.map((row) => row.id)).toEqual([use.id]);
  expect(data.totals.filteredSum).toBe(300000);
  expect((await getLedger(ctx, { project_id: other.project.id })).total).toBe(0);
  const audit = await queryAudit(ctx, {});
  expect(JSON.stringify(audit)).not.toContain(hidden.id);
  expect(JSON.stringify(audit)).toContain(use.id);
  await expect(queryAudit(ctx, { use_id: hidden.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  const { token } = await s.f.session(s.driverUser.id);
  for (const route of [ledgerRoute, exportRoute, dashboardRoute, auditRoute])
    expect((await callRoute(database().db, route, { token })).status).toBe(403);
  const session = await s.f.session(manager.id);
  const exported = await callRoute(database().db, exportRoute, { token: session.token });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await exported.arrayBuffer());
  expect(book.worksheets[0].rowCount).toBe(3);
});
it('정산월은 사용일이 아닌 포함 명세 기간이며 지급 취소 기록은 미지급으로 파생한다', async () => {
  const s = await setupScenario(database().db);
  const use = await approved(s);
  const st = await statement(s, [use], 300000);
  const base = { project_id: s.project.id };
  expect(
    (
      await getLedger(s.adminCtx, {
        ...base,
        period: '2026-10',
        settlement_status: 'SETTLED',
        payment_status: 'UNPAID',
      })
    ).total,
  ).toBe(1);
  expect((await getLedger(s.adminCtx, { ...base, period: '2026-09' })).total).toBe(0);
  const [payment] = await database()
    .db.insert(paymentRecords)
    .values({
      statement_id: st.id,
      kind: 'PAYMENT',
      amount: st.grand_total,
      paid_on: '2026-10-01',
      method: '계좌이체',
      recorded_by: s.admin.id,
    })
    .returning();
  expect((await getLedger(s.adminCtx, { ...base, payment_status: 'PAID' })).total).toBe(1);
  await database()
    .db.update(paymentRecords)
    .set({ voided_at: new Date() })
    .where(eq(paymentRecords.id, payment.id));
  expect((await getLedger(s.adminCtx, { ...base, payment_status: 'UNPAID' })).total).toBe(1);
  expect((await getLedger(s.adminCtx, base)).rows[0].locked_statements[0].statement_no).toBe(st.statement_no);
});
it('대시보드는 명세 직접 합산으로 여러 사용 건의 미지급액 중복을 방지한다', async () => {
  const s = await setupScenario(database().db);
  const a = await approved(s);
  const b = await approved(s, '2');
  const c = await approved(s, '3');
  await statement(s, [a, b], 990000);
  const manager = await s.f.user({ role: 'SITE_MANAGER' });
  await s.f.assignment(manager.id, s.project.id);
  const dashboard = await getDashboard(s.f.context(manager));
  expect(dashboard.unpaid_count).toBe(1);
  expect(dashboard.unpaid_amount).toBe(990000);
  expect(dashboard.unsettled_approved_amount).toBe(c.charge_lines[0].approved_amount);
});
it('서로 다른 현장을 묶은 명세 총액은 일부 배정 담당자에게 노출하지 않는다', async () => {
  const s = await setupScenario(database().db);
  const project = await s.f.project();
  const a = await approved(s);
  const b = await approved({ ...s, input: { ...s.input, project_id: project.id } });
  await statement(s, [a, b], 660000);
  const manager = await s.f.user({ role: 'SITE_MANAGER' });
  await s.f.assignment(manager.id, s.project.id);
  expect((await getDashboard(s.f.context(manager))).unpaid_amount).toBe(0);
  await s.f.assignment(manager.id, project.id);
  expect((await getDashboard(s.f.context(manager))).unpaid_amount).toBe(660000);
});
it('증빙 누락은 현장 정책과 업로드·대체·삭제 상태를 따른다', async () => {
  const s = await setupScenario(database().db, { evidence_policy: 'PHOTO_OR_ALTERNATIVE' });
  const use = await createUse(s.adminCtx, s.input);
  expect((await getLedger(s.adminCtx, { use_id: use.id, evidence_missing: 'true' })).total).toBe(1);
  const [file] = await database()
    .db.insert(evidence)
    .values({
      vehicle_use_id: use.id,
      kind: 'SLIP_NO',
      text_value: 'SLIP-01',
      client_upload_id: crypto.randomUUID(),
      uploaded_by: s.admin.id,
      upload_status: 'UPLOADED',
    })
    .returning();
  expect((await getLedger(s.adminCtx, { use_id: use.id, evidence_missing: 'true' })).total).toBe(0);
  await database().db.update(evidence).set({ deleted_at: new Date() }).where(eq(evidence.id, file.id));
  expect((await getLedger(s.adminCtx, { use_id: use.id, evidence_missing: 'true' })).total).toBe(1);
});
it('최근 경로는 사용자/기사별이며 현장 권한과 기사 본인 범위를 적용한다', async () => {
  const s = await setupScenario(database().db);
  await approved(s);
  const rows = await getRecentRoutes(s.driverCtx, { driver_id: s.driver.id, limit: 1 });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ origin: '부산항', destination: '시청', frequency: 1 });
  const other = await s.f.driver();
  await expect(getRecentRoutes(s.driverCtx, { driver_id: other.id })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  expect(await getRecentRoutes(s.driverCtx, {})).toHaveLength(0);
});
