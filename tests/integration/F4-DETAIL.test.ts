import { expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { eq } from 'drizzle-orm';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { callRoute } from '../helpers/routes';
import { createUse, submitUse, approveUse } from '../../src/server/services/uses';
import { getSummary } from '../../src/server/services/summary';
import {
  companySettings,
  counterparties,
  projectAssignments,
  chargeLines,
  rateAgreements,
} from '../../src/server/db/schema';
import { GET as summaryRoute } from '../../src/app/api/summary/route';
import { GET as tradeRoute } from '../../src/app/api/summary/trade.xlsx/route';

const database = testDatabase();
const period = { from: '2026-09-01', to: '2026-09-30' };
async function prepare() {
  const s = await setupScenario(database().db);
  const manager = await s.f.user({ role: 'SETTLEMENT_MANAGER' });
  const assignment = await s.f.assignment(manager.id, s.project.id);
  const other = await s.f.counterparty({ name: '다른 운송사' });
  await s.f.rate(other.id);
  const second = await s.f.project({ name: '시험/현장' });
  await s.f.assignment(manager.id, second.id);
  const hidden = await s.f.project({ name: '비공개 현장' });
  const driver = await s.f.driver({ name: '가나다 기사' });
  await s.f.affiliation(driver.id, s.payee.id);
  for (const [project_id, payee_counterparty_id, driver_id, use_date] of [
    [s.project.id, s.payee.id, s.driver.id, '2026-09-01'],
    [second.id, s.payee.id, driver.id, '2026-09-30'],
    [s.project.id, other.id, s.driver.id, '2026-09-15'],
    [hidden.id, s.payee.id, s.driver.id, '2026-09-15'],
  ]) {
    let use = await createUse(s.adminCtx, {
      ...s.input,
      project_id,
      payee_counterparty_id,
      driver_id,
      use_date,
      load_tonnage: '8',
      quantity: '1',
      cargo_desc: '시험 자재',
      trips: [
        { seq: 1, origin: '공장', destination: '현장' },
        { seq: 2, origin: '창고', destination: '현장' },
      ],
    });
    use = await submitUse(s.adminCtx, use.id, { version: use.version });
    await approveUse(s.adminCtx, use.id, { version: use.version });
  }
  await createUse(s.adminCtx, { ...s.input, quantity: '2' });
  await createUse(s.adminCtx, { ...s.input, billing_unit: 'PER_HOUR' });
  return { ...s, manager, assignment, second, hidden, other, ctx: s.f.context(manager) };
}

it('상세와 집계의 승인·검수 전 합계, 지급처·현장·기사 필터 및 정렬이 일치한다', async () => {
  const s = await prepare();
  for (const include of ['approved', 'all']) {
    const data = await getSummary(s.ctx, { ...period, include, payee_counterparty_id: s.payee.id });
    expect(data.totals.approved_supply).toBe(600000);
    expect(data.rows.filter((r) => r.status === 'APPROVED').reduce((n, r) => n + (r.supply ?? 0), 0)).toBe(
      data.totals.approved_supply,
    );
    expect(data.rows.filter((r) => r.status === 'APPROVED').reduce((n, r) => n + (r.tax ?? 0), 0)).toBe(
      data.totals.approved_tax,
    );
    expect(data.rows.filter((r) => r.status === 'PENDING').reduce((n, r) => n + (r.supply ?? 0), 0)).toBe(
      data.totals.pending_supply,
    );
    expect(data.totals.pending_supply).toBe(include === 'all' ? 600000 : 0);
    expect(data.totals.pending_unknown_count).toBe(include === 'all' ? 1 : 0);
    expect(data.rows[0]).toMatchObject({
      route: '공장 → 현장 외 1회',
      quantity: '1.000',
      unit_price: 300000,
      load_tonnage: '8.000',
      cargo_desc: '시험 자재',
    });
    expect(JSON.stringify(data)).not.toContain(s.hidden.id);
    expect(data.rows.map((r) => r.use_date)).toEqual(data.rows.map((r) => r.use_date).sort());
  }
  const one = await getSummary(s.ctx, { ...period, project_id: s.second.id, driver_id: s.driver.id });
  expect(one.rows).toEqual([]);
  const sorted = await getSummary(s.ctx, { ...period, sort: 'driver' });
  expect(sorted.rows[0].driver_name).toBe('가나다 기사');
});

it('상세·출력은 배정 회수와 역할을 재검사하며 잘못된 필터는 거부한다', async () => {
  const s = await prepare();
  const token = (await s.f.session(s.manager.id)).token;
  const driverToken = (await s.f.session(s.driverUser.id)).token;
  for (const route of [summaryRoute, tradeRoute]) {
    expect(
      (
        await callRoute(database().db, route, {
          token: driverToken,
          path: `/api/summary?${new URLSearchParams(period)}`,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await callRoute(database().db, route, {
          token,
          path: `/api/summary?${new URLSearchParams({ ...period, project_id: s.hidden.id })}`,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await callRoute(database().db, route, {
          token,
          path: `/api/summary?${new URLSearchParams({ ...period, payee_counterparty_id: 'bad' })}`,
        })
      ).status,
    ).toBe(422);
  }
  await database()
    .db.update(projectAssignments)
    .set({ revoked_at: new Date() })
    .where(eq(projectAssignments.id, s.assignment.id));
  await expect(getSummary(s.ctx, { ...period, project_id: s.project.id })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
});

it('거래명세표는 현장별 시트·값·합계·회사/지급처 정보와 인쇄 서식을 보존한다', async () => {
  const s = await prepare();
  await database().db.delete(companySettings);
  await s.f.company({
    name: '시연 회사',
    biz_no: '000-00-00000',
    representative: '시연 대표',
    address: '시연 주소',
  });
  await database()
    .db.update(counterparties)
    .set({ biz_no: '111-11-11111' })
    .where(eq(counterparties.id, s.payee.id));
  const token = (await s.f.session(s.manager.id)).token;
  for (const single of [true, false]) {
    const query = { ...period, include: 'all', ...(single ? { payee_counterparty_id: s.payee.id } : {}) };
    const response = await callRoute(database().db, tradeRoute, {
      token,
      path: `/api/summary/trade.xlsx?${new URLSearchParams(query)}`,
    });
    expect(response.status).toBe(200);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    expect(book.worksheets).toHaveLength(2);
    const model = JSON.stringify(book.model);
    expect(model).toContain(single ? '테스트 운송사' : '여러 지급처');
    if (single) expect(model).toContain('111-11-11111');
    for (const value of ['시연 회사', '000-00-00000', '시연 대표', '시연 주소'])
      expect(model).toContain(value);
    expect(model).not.toContain(s.hidden.name);
    for (const sheet of book.worksheets) {
      expect(sheet.getCell('A1').text).toMatch(/^거 래 명 세 표\(/);
      expect(sheet.pageSetup).toMatchObject({ orientation: 'landscape', paperSize: 9, fitToWidth: 1 });
      expect(sheet.getRow(10).values).toEqual([
        undefined,
        '월',
        '일',
        '품목',
        '규격',
        '수량',
        '단가',
        '공급가액',
        '비고',
        '기사명',
      ]);
      const project = sheet.getCell('A1').text.includes(s.second.name) ? s.second : s.project;
      const data = await getSummary(s.ctx, { ...query, project_id: project.id });
      const total = sheet.getRows(1, sheet.rowCount)!.find((r) => r.getCell(1).text === '합계 금액')!;
      expect(total.getCell(7).value).toBe(data.totals.approved_supply);
      expect(total.getCell(7).numFmt).toBe('#,##0');
      expect(sheet.getRow(total.number + 1).getCell(7).value).toBe(data.totals.approved_tax);
      expect(sheet.getRow(total.number + 2).getCell(7).value).toBe(data.totals.grand_total);
      sheet.eachRow((r) => r.eachCell((c) => expect(c.type).not.toBe(ExcelJS.ValueType.Formula)));
    }
  }
});

it('음수 조정은 상세에서도 집계와 동일하게 처리한다', async () => {
  const s = await prepare();
  const data = await getSummary(s.ctx, { ...period, project_id: s.second.id });
  await database()
    .db.update(chargeLines)
    .set({ approved_amount: -10000, tax_amount: -1000, charge_type: 'ADJUSTMENT' })
    .where(eq(chargeLines.id, data.rows[0].id));
  const adjusted = await getSummary(s.ctx, { ...period, project_id: s.second.id });
  expect(adjusted.rows[0].supply).toBe(-10000);
  expect(adjusted.totals.approved_supply).toBe(-10000);
});

it('부가세 포함·승인액 변경·0원·보류·반려·삭제·고객청구도 상세 합계와 일치한다', async () => {
  const s = await setupScenario(database().db);
  await database()
    .db.update(rateAgreements)
    .set({ tax_mode: 'VAT_INCLUDED', unit_price: 110001 })
    .where(eq(rateAgreements.id, s.rate.id));
  const customer = await s.f.counterparty({ kind: 'CUSTOMER' });
  await s.f.rate(customer.id, { direction: 'RECEIVABLE', unit_price: 900000 });
  let use = await createUse(s.adminCtx, {
    ...s.input,
    customer_counterparty_id: customer.id,
    charge_lines: [
      { charge_type: 'BASE', quantity: '1' },
      { charge_type: 'BASE', quantity: '1', direction: 'RECEIVABLE' },
      { charge_type: 'TOLL', requested_amount: 1000, reason: '보류 비용' },
      { charge_type: 'WAITING', requested_amount: 2000, reason: '반려 비용' },
      { charge_type: 'OTHER', requested_amount: 3000, reason: '삭제 비용' },
    ],
  });
  use = await submitUse(s.adminCtx, use.id, { version: use.version });
  await approveUse(s.adminCtx, use.id, {
    version: use.version,
    lines: use.charge_lines.map((line) => ({
      id: line.id,
      line_review_status:
        line.charge_type === 'TOLL'
          ? ('HELD' as const)
          : line.charge_type === 'WAITING'
            ? ('REJECTED' as const)
            : ('APPROVED' as const),
      reason: '시연 검수',
    })),
  });
  const deleted = use.charge_lines.find((line) => line.charge_type === 'OTHER')!;
  await database()
    .db.update(chargeLines)
    .set({ deleted_at: new Date() })
    .where(eq(chargeLines.id, deleted.id));
  await createUse(s.adminCtx, { ...s.input, quantity: '1' });
  let zero = await createUse(s.adminCtx, { ...s.input, quantity: '0' });
  zero = await submitUse(s.adminCtx, zero.id, { version: zero.version });
  await approveUse(s.adminCtx, zero.id, { version: zero.version });
  const query = { ...period, project_id: s.project.id, include: 'all' };
  const data = await getSummary(s.adminCtx, query);
  expect(data.totals).toMatchObject({ approved_supply: 100001, approved_tax: 10000, pending_supply: 100001 });
  expect(data.rows).toHaveLength(3);
  expect(data.rows.some((row) => row.supply === 0)).toBe(true);
  expect(
    data.rows.filter((row) => row.status === 'APPROVED').reduce((n, row) => n + (row.supply ?? 0), 0),
  ).toBe(data.totals.approved_supply);
  expect(
    data.rows.filter((row) => row.status === 'PENDING').reduce((n, row) => n + (row.supply ?? 0), 0),
  ).toBe(data.totals.pending_supply);
  const base = use.charge_lines.find((line) => line.direction === 'PAYABLE' && line.charge_type === 'BASE')!;
  await database()
    .db.update(chargeLines)
    .set({ approved_amount: 250000, tax_amount: 25000 })
    .where(eq(chargeLines.id, base.id));
  const changed = await getSummary(s.adminCtx, query);
  expect(changed.rows.find((row) => row.id === base.id)).toMatchObject({
    unit_price: 250000,
    supply: 250000,
    tax: 25000,
  });
});

it('출력의 현장 필터·중복 시트명·현장 담당자 개인정보·권한 밖 지급처를 검사한다', async () => {
  const s = await prepare();
  const sameName = await s.f.project({ name: s.second.name });
  await s.f.assignment(s.manager.id, sameName.id);
  let use = await createUse(s.adminCtx, { ...s.input, project_id: sameName.id, quantity: '1' });
  use = await submitUse(s.adminCtx, use.id, { version: use.version });
  await approveUse(s.adminCtx, use.id, { version: use.version });
  const token = (await s.f.session(s.manager.id)).token;
  const response = await callRoute(database().db, tradeRoute, {
    token,
    path: `/api/summary/trade.xlsx?${new URLSearchParams(period)}`,
  });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await response.arrayBuffer());
  expect(book.worksheets).toHaveLength(3);
  expect(new Set(book.worksheets.map((sheet) => sheet.name)).size).toBe(3);
  const site = await s.f.user({ role: 'SITE_MANAGER' });
  await s.f.assignment(site.id, s.project.id);
  const siteToken = (await s.f.session(site.id)).token;
  await database()
    .db.update(counterparties)
    .set({ biz_no: '222-22-22222' })
    .where(eq(counterparties.id, s.payee.id));
  const filtered = await callRoute(database().db, tradeRoute, {
    token: siteToken,
    path: `/api/summary/trade.xlsx?${new URLSearchParams({ ...period, project_id: s.project.id, payee_counterparty_id: s.payee.id })}`,
  });
  const single = new ExcelJS.Workbook();
  await single.xlsx.load(await filtered.arrayBuffer());
  expect(single.worksheets).toHaveLength(1);
  expect(JSON.stringify(single.model)).not.toContain('222-22-22222');
  const hiddenPayee = await s.f.counterparty({ name: '비공개 지급처', biz_no: '333-33-33333' });
  const empty = await callRoute(database().db, tradeRoute, {
    token: siteToken,
    path: `/api/summary/trade.xlsx?${new URLSearchParams({ ...period, payee_counterparty_id: hiddenPayee.id })}`,
  });
  const emptyBook = new ExcelJS.Workbook();
  await emptyBook.xlsx.load(await empty.arrayBuffer());
  expect(JSON.stringify(emptyBook.model)).not.toContain(hiddenPayee.name);
  expect(JSON.stringify(emptyBook.model)).not.toContain(hiddenPayee.biz_no);
});
