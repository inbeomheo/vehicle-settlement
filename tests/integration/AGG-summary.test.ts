import { expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { eq } from 'drizzle-orm';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { callRoute } from '../helpers/routes';
import {
  createUse,
  submitUse,
  approveUse,
  reviewChargeLine,
  cancelUse,
} from '../../src/server/services/uses';
import type { CreateUseInput } from '../../src/server/services/schemas';
import { getSummary, summaryQuerySchema } from '../../src/server/services/summary';
import { getLedger } from '../../src/server/services/ledger';
import { driverSettlements } from '../../src/server/services/statements-driver';
import {
  chargeLines,
  driverAffiliations,
  projectAssignments,
  rateAgreements,
  users,
} from '../../src/server/db/schema';
import { GET as summaryRoute } from '../../src/app/api/summary/route';
import { GET as exportRoute } from '../../src/app/api/summary/export.xlsx/route';

const database = testDatabase();
const period = { from: '2026-08-19', to: '2026-09-18' };
async function scenario() {
  const s = await setupScenario(database().db);
  const manager = await s.f.user({ role: 'SITE_MANAGER' });
  const assignment = await s.f.assignment(manager.id, s.project.id);
  return { ...s, manager, managerAssignment: assignment, ctx: s.f.context(manager) };
}
type Scenario = Awaited<ReturnType<typeof scenario>>;
async function approved(s: Scenario, overrides: Partial<CreateUseInput> = {}) {
  let use = await createUse(s.adminCtx, { ...s.input, quantity: '1', ...overrides });
  use = await submitUse(s.adminCtx, use.id, { version: use.version });
  return approveUse(s.adminCtx, use.id, { version: use.version });
}

it('지급 승인액은 대장·기사 인정 공급가와 같고 비용/운행 행 수로 중복되지 않는다', async () => {
  const s = await scenario();
  const customer = await s.f.counterparty({ kind: 'CUSTOMER' });
  await s.f.rate(customer.id, { direction: 'RECEIVABLE', unit_price: 900000 });
  await approved(s, {
    customer_counterparty_id: customer.id,
    trips: [
      { seq: 1, origin: '공장', destination: '현장' },
      { seq: 2, origin: '창고', destination: '현장' },
    ],
    charge_lines: [
      { charge_type: 'BASE', quantity: '1' },
      { charge_type: 'BASE', direction: 'RECEIVABLE', quantity: '1' },
      { charge_type: 'TOLL', requested_amount: 12345, reason: '통행료' },
    ],
  });
  await approved(s, { quantity: '2' });
  const summary = await getSummary(s.ctx, period);
  const ledger = await getLedger(s.ctx, period);
  const driver = await driverSettlements(s.driverCtx, { periodStart: period.from, periodEnd: period.to });
  expect(summary.totals.approved_supply).toBe(912345);
  expect(summary.totals.approved_supply).toBe(ledger.totals.filteredSum);
  expect(summary.totals.approved_supply).toBe(driver.uses.reduce((sum, use) => sum + use.approved_supply, 0));
  expect(summary.totals).toMatchObject({
    count: 2,
    driver_count: 1,
    project_count: 1,
    approved_tax: 91235,
    grand_total: 1003580,
    pending_supply: 0,
  });
  expect(summary.cells).toHaveLength(1);
  expect(summary.drivers[0].id).toBe(s.driver.id);
  expect(summary.drivers[0].id).not.toBe(s.admin.id);
});

it('사용 전체 승인 전의 개별 승인·보류·반려·삭제를 기존 승인 금액과 동일하게 처리한다', async () => {
  const s = await scenario();
  let use = await createUse(s.adminCtx, {
    ...s.input,
    quantity: '1',
    charge_lines: [
      { charge_type: 'BASE', quantity: '1' },
      { charge_type: 'TOLL', requested_amount: 10000, reason: '영수증' },
      { charge_type: 'WAITING', requested_amount: 20000, reason: '대기' },
      { charge_type: 'OTHER', requested_amount: 30000, reason: '삭제 비용' },
    ],
  });
  use = await submitUse(s.adminCtx, use.id, { version: use.version });
  let version = use.version;
  for (const line of use.charge_lines) {
    const status =
      line.charge_type === 'BASE'
        ? 'APPROVED'
        : line.charge_type === 'TOLL'
          ? 'HELD'
          : line.charge_type === 'WAITING'
            ? 'REJECTED'
            : 'APPROVED';
    const result = await reviewChargeLine(s.adminCtx, line.id, {
      version,
      line_review_status: status,
      reason: '검수 결과',
    });
    version = result.use_version;
    if (line.charge_type === 'OTHER')
      await database()
        .db.update(chargeLines)
        .set({ deleted_at: new Date() })
        .where(eq(chargeLines.id, line.id));
  }
  for (const include of ['approved', 'all']) {
    const summary = await getSummary(s.ctx, { ...period, include });
    expect(summary.totals).toMatchObject({ count: 1, approved_supply: 300000, pending_supply: 0 });
    expect(summary.totals.approved_supply).toBe((await getLedger(s.ctx, period)).totals.filteredSum);
  }
});

it('검수 전 포함은 부가세 포함 단가·미정·기본 포함 비용을 별도로 집계한다', async () => {
  const s = await scenario();
  await database()
    .db.update(rateAgreements)
    .set({ tax_mode: 'VAT_INCLUDED', unit_price: 110001 })
    .where(eq(rateAgreements.id, s.rate.id));
  await approved(s);
  await createUse(s.adminCtx, {
    ...s.input,
    quantity: '1',
    charge_lines: [
      { charge_type: 'BASE', quantity: '1' },
      { charge_type: 'TOLL', requested_amount: 5000, reason: '운임에 포함', included_in_base: true },
    ],
  });
  await createUse(s.adminCtx, { ...s.input, billing_unit: 'PER_HOUR' });
  const only = await getSummary(s.ctx, period);
  const all = await getSummary(s.ctx, { ...period, include: 'all' });
  expect(only.totals).toMatchObject({
    count: 1,
    approved_supply: 100001,
    approved_tax: 10000,
    pending_supply: 0,
  });
  expect(all.totals).toMatchObject({
    count: 3,
    approved_supply: 100001,
    approved_tax: 10000,
    pending_supply: 100001,
    pending_unknown_count: 1,
  });
  expect(all.cells[0].pending_supply).toBe(all.totals.pending_supply);
});

it('시작·종료일은 포함하고 취소·기간 밖 사용은 제외하며 0원과 음수 조정을 보존한다', async () => {
  const s = await scenario();
  await approved(s, { use_date: period.from });
  await approved(s, { use_date: period.to, quantity: '0' });
  await approved(s, { use_date: '2026-08-18' });
  await approved(s, { use_date: '2026-09-19' });
  const canceled = await approved(s);
  await cancelUse(s.adminCtx, canceled.id, { version: canceled.version, reason: '운행 취소' });
  const adjustment = await approved(s);
  // A stored negative approved adjustment is a final supply difference.
  await database()
    .db.update(chargeLines)
    .set({ charge_type: 'ADJUSTMENT', approved_amount: -10000, tax_amount: -1000 })
    .where(eq(chargeLines.id, adjustment.charge_lines[0].id));
  const summary = await getSummary(s.ctx, period);
  expect(summary.totals).toMatchObject({ count: 3, approved_supply: 290000, approved_tax: 29000 });
  expect(summary.totals.approved_supply).toBe((await getLedger(s.ctx, period)).totals.filteredSum);
  expect((await getSummary(s.ctx, { from: period.to, to: period.to })).totals).toMatchObject({
    count: 1,
    approved_supply: 0,
  });
});

it('운행일 당시 소속을 합치고 동명 기사·현장은 ID로 구분한다', async () => {
  const s = await scenario();
  const next = await s.f.counterparty({ name: '새 운송사' });
  await database()
    .db.update(driverAffiliations)
    .set({ valid_to: '2026-08-31' })
    .where(eq(driverAffiliations.id, s.affiliation.id));
  await s.f.affiliation(s.driver.id, next.id, { valid_from: '2026-09-01' });
  await s.f.rate(next.id);
  await approved(s, { use_date: period.from });
  await approved(s);
  const p = await s.f.project({ name: s.project.name });
  const d = await s.f.driver({ name: s.driver.name });
  await s.f.affiliation(d.id, s.payee.id);
  await s.f.assignment(s.manager.id, p.id);
  await approved(s, { project_id: p.id, driver_id: d.id });
  const summary = await getSummary(s.ctx, period);
  expect(summary.drivers.find((driver) => driver.id === s.driver.id)?.affiliations).toEqual([
    '새 운송사',
    '테스트 운송사',
  ]);
  expect(summary.totals).toMatchObject({
    count: 3,
    driver_count: 2,
    project_count: 2,
    approved_supply: 900000,
  });
  expect(summary.cells).toHaveLength(2);
});

it('현장 배정·회수·정산 담당 범위를 JSON과 엑셀에서 재검사하고 기사는 403이다', async () => {
  const s = await scenario();
  await approved(s);
  const hidden = await s.f.project({ name: '조회 불가 현장' });
  await approved(s, { project_id: hidden.id });
  const token = (await s.f.session(s.manager.id)).token;
  const path = `/api/summary?${new URLSearchParams(period)}`;
  const response = await callRoute(database().db, summaryRoute, { token, path });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.data.projects.map((p: { id: string }) => p.id)).toEqual([s.project.id]);
  expect(JSON.stringify(body)).not.toContain(hidden.id);
  const limited = await s.f.user({ role: 'SETTLEMENT_MANAGER', all_projects: false });
  await s.f.assignment(limited.id, s.project.id);
  expect((await getSummary(s.f.context(limited), period)).totals.count).toBe(1);
  await database().db.update(users).set({ all_projects: true }).where(eq(users.id, limited.id));
  expect((await getSummary(s.f.context(limited), period)).projects.some((p) => p.id === hidden.id)).toBe(
    true,
  );
  const driverToken = (await s.f.session(s.driverUser.id)).token;
  for (const route of [summaryRoute, exportRoute]) {
    expect((await callRoute(database().db, route, { token: driverToken, path })).status).toBe(403);
    expect((await callRoute(database().db, route, { path })).status).toBe(401);
  }
  const exported = await callRoute(database().db, exportRoute, { token, path });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await exported.arrayBuffer());
  expect(JSON.stringify(book.model)).not.toContain(hidden.name);
  await database()
    .db.update(projectAssignments)
    .set({ revoked_at: new Date() })
    .where(eq(projectAssignments.id, s.managerAssignment.id));
  expect((await getSummary(s.ctx, period)).cells).toEqual([]);
  await database().db.update(users).set({ status: 'DISABLED' }).where(eq(users.id, s.manager.id));
  expect((await callRoute(database().db, exportRoute, { token, path })).status).toBe(401);
});

it('세 시트의 숫자·전체/행/열 합계·기간·포함 기준이 API와 일치한다', async () => {
  const s = await scenario();
  await approved(s);
  const p = await s.f.project({ name: '두 번째 현장' });
  await s.f.assignment(s.manager.id, p.id);
  await approved(s, { project_id: p.id, quantity: '2' });
  await createUse(s.adminCtx, { ...s.input, quantity: '1' });
  const token = (await s.f.session(s.manager.id)).token;
  for (const include of ['approved', 'all']) {
    const data = await getSummary(s.ctx, { ...period, include });
    const response = await callRoute(database().db, exportRoute, {
      token,
      path: `/api/summary/export.xlsx?${new URLSearchParams({ ...period, include })}`,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain(
      encodeURIComponent(`현장기사별집계_${period.from}_${period.to}.xlsx`),
    );
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(['현장별', '기사별', '표']);
    for (const sheet of book.worksheets) {
      expect(sheet.getCell('A1').text).toContain(`${period.from} ~ ${period.to}`);
      expect(sheet.getCell('A2').text).toContain(include === 'all' ? '검수 전 포함' : '승인된 금액만');
    }
    for (const sheet of book.worksheets.slice(0, 2)) {
      const total = sheet.getRow(sheet.rowCount);
      expect(total.getCell(5).value).toBe(data.totals.approved_supply);
      expect(total.getCell(5).numFmt).toBe('#,##0');
      expect(total.getCell(6).value).toBe(data.totals.approved_tax);
      expect(total.getCell(7).value).toBe(data.totals.grand_total);
      if (include === 'all') expect(total.getCell(8).value).toBe(data.totals.pending_supply);
    }
    const table = book.getWorksheet('표')!;
    const last = table.getRow(table.rowCount - (include === 'all' ? 1 : 0));
    expect(last.getCell(table.columnCount).value).toBe(data.totals.approved_supply);
    data.projects.forEach((project, index) => {
      expect(last.getCell(index + 2).value).toBe(project.approved_supply);
      expect(table.getRow(4).getCell(index + 2).value).toBe(project.approved_supply);
    });
  }
});

it('잘못된 날짜·역전·1년 초과·포함 기준은 JSON/엑셀 모두 422, 빈 결과는 정상이다', async () => {
  const s = await scenario();
  const token = (await s.f.session(s.manager.id)).token;
  for (const query of [
    {},
    { from: '2026-02-30', to: '2026-03-01' },
    { from: '2026-09-19', to: '2026-09-18' },
    { from: '2025-09-19', to: '2026-09-19' },
    { ...period, include: 'unknown' },
  ]) {
    for (const route of [summaryRoute, exportRoute]) {
      const response = await callRoute(database().db, route, {
        token,
        path: `/api/summary?${new URLSearchParams(query as Record<string, string>)}`,
      });
      expect(response.status).toBe(422);
    }
  }
  expect(summaryQuerySchema.safeParse({ from: '2025-09-19', to: '2026-09-18' }).success).toBe(true);
  expect(summaryQuerySchema.safeParse({ from: '2023-03-01', to: '2024-02-29' }).success).toBe(true);
  const empty = await getSummary(s.ctx, period);
  expect(empty.cells).toEqual([]);
  expect(empty.totals.approved_supply).toBe(0);
});
