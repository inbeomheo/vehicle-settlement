import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { GET } from '../../src/app/api/statements/mine/route';
import { chargeLines, projectAssignments, rateAgreements, users } from '../../src/server/db/schema';
import { driverSettlements } from '../../src/server/services/statements-driver';
import { getLedger as ledger } from '../../src/server/services/ledger';
import { approveUse, cancelUse, createUse, listUses, submitUse } from '../../src/server/services/uses';
import { testDatabase } from '../helpers/database';
import { callRoute } from '../helpers/routes';
import { approved, confirmed, scenario } from './W4-fixtures';

const database = testDatabase();
const period = { periodStart: '2026-09-01', periodEnd: '2026-09-30' };

describe('DRV 기사 현장별·날짜별 정산', () => {
  it('본인 PAYABLE만 집계하며 기존 사용대장·운행 요약·확정명세 공급가와 일치한다', async () => {
    const s = await scenario(database().db);
    const second = await s.f.project({ name: '두 번째 현장' });
    await s.f.assignment(s.driverUser.id, second.id);
    const customer = await s.f.counterparty({ name: '비공개 고객', kind: 'CUSTOMER' });
    await s.f.rate(customer.id, { direction: 'RECEIVABLE', unit_price: 987654321 });
    const first = await approved(s, {
      customer_counterparty_id: customer.id,
      trips: [
        { seq: 1, origin: '창고', destination: '현장' },
        { seq: 2, origin: '공장', destination: '현장' },
      ],
    });
    const next = await approved(s, { project_id: second.id, use_date: '2026-09-18' });
    const third = await approved(s, { project_id: second.id, use_date: '2026-09-18' });
    const other = await s.f.driver({ name: '다른 기사' });
    await s.f.affiliation(other.id, s.payee.id);
    const hidden = await approved(s, { driver_id: other.id });
    const statement = await confirmed(
      s,
      [first, next, third, hidden].flatMap((use) =>
        use.charge_lines.filter((line) => line.direction === 'PAYABLE').map((line) => line.id),
      ),
    );
    const result = await driverSettlements(s.driverCtx, period);
    expect(result.uses).toHaveLength(3);
    expect(result.period_totals).toMatchObject({
      count: 3,
      trip_count: 4,
      approved_supply: 900000,
      pending_supply: 0,
    });
    expect(result.projects.map((project) => project.project_id)).toEqual([second.id, s.project.id]);
    expect(result.projects.map((project) => project.approved_supply)).toEqual([600000, 300000]);
    expect(result.dates.map((day) => day.date)).toEqual(['2026-09-18', '2026-09-15']);
    expect(result.dates.map((day) => day.approved_supply)).toEqual([600000, 300000]);
    expect(result.uses.find((use) => use.id === first.id)?.route_summary).toBe('창고 → 현장 외 1회');
    const listed = await listUses(s.driverCtx, { from: period.periodStart, to: period.periodEnd });
    const ledgerResult = await ledger(s.adminCtx, {
      from: period.periodStart,
      to: period.periodEnd,
      driver_id: s.driver.id,
    });
    expect(result.period_totals.approved_supply).toBe(listed.totals.filteredSum);
    expect(result.period_totals.approved_supply).toBe(ledgerResult.totals.filteredSum);
    expect(result.uses.reduce((sum, use) => sum + use.approved_supply, 0)).toBe(
      result.period_totals.approved_supply,
    );
    expect(result.statements[0]).toMatchObject({ id: statement.id, supply_total: 900000 });
    expect(JSON.stringify(result)).not.toMatch(
      new RegExp(`${hidden.id}|${hidden.use_no}|${other.id}|RECEIVABLE|987654321|비공개 고객`),
    );
  });

  it('시작일·종료일을 포함하고 기간 밖 운행은 제외하며 취소 행은 남기되 건수·회차·금액에서 제외한다', async () => {
    const s = await scenario(database().db);
    const rows = [];
    for (const use_date of ['2026-08-18', '2026-08-19', '2026-09-18', '2026-09-19'])
      rows.push(await approved(s, { use_date }));
    const canceled = await createUse(s.driverCtx, { ...s.input, use_date: '2026-09-18' });
    await cancelUse(s.driverCtx, canceled.id, { version: canceled.version, reason: '운행 취소' });
    const result = await driverSettlements(s.driverCtx, {
      periodStart: '2026-08-19',
      periodEnd: '2026-09-18',
    });
    expect(result.uses.map((use) => use.id).sort()).toEqual([rows[1].id, rows[2].id, canceled.id].sort());
    expect(result.period_totals).toMatchObject({
      count: 2,
      trip_count: 2,
      approved_supply: 600000,
      pending_supply: 0,
      canceled_count: 1,
    });
    expect(result.dates[0]).toMatchObject({
      date: '2026-09-18',
      count: 1,
      approved_supply: 300000,
      canceled_count: 1,
    });
  });

  it('승인·보류·거절·삭제 비용을 구분하고 검수 전 계약액·요청액은 세금 제외 예상액으로 표시한다', async () => {
    const s = await scenario(database().db);
    await database()
      .db.update(rateAgreements)
      .set({ unit_price: 330000, tax_mode: 'VAT_INCLUDED' })
      .where(eq(rateAgreements.id, s.rate.id));
    const use = await createUse(s.driverCtx, {
      ...s.input,
      charge_lines: [
        { charge_type: 'BASE', billing_unit: 'PER_DAY' },
        { charge_type: 'WAITING', requested_amount: 11000, reason: '대기' },
        { charge_type: 'TOLL', requested_amount: 5500, reason: '거절 비용' },
        { charge_type: 'OTHER', requested_amount: 2200, reason: '삭제 비용' },
        {
          charge_type: 'EXPENSE',
          requested_amount: 1100,
          included_in_base: true,
          reason: '기본 포함',
        },
      ],
    });
    await database()
      .db.update(chargeLines)
      .set({ tax_mode: 'VAT_INCLUDED' })
      .where(eq(chargeLines.vehicle_use_id, use.id));
    const find = (kind: string) => use.charge_lines.find((line) => line.charge_type === kind)!;
    await database()
      .db.update(chargeLines)
      .set({ deleted_at: new Date() })
      .where(eq(chargeLines.id, find('OTHER').id));
    const before = await driverSettlements(s.driverCtx, period);
    expect(before.period_totals).toMatchObject({ approved_supply: 0, pending_supply: 315000 });
    const submitted = await submitUse(s.driverCtx, use.id, { version: use.version });
    await approveUse(s.adminCtx, use.id, {
      version: submitted.version,
      lines: [
        { id: find('WAITING').id, line_review_status: 'HELD', reason: '대기 확인' },
        { id: find('TOLL').id, line_review_status: 'REJECTED', reason: '잘못 입력' },
      ],
    });
    const after = await driverSettlements(s.driverCtx, period);
    expect(after.period_totals).toMatchObject({ approved_supply: 300000, pending_supply: 10000 });
    expect(after.uses[0]).toMatchObject({ held_count: 1, pending_count: 1 });
    expect(after.period_totals.approved_supply).toBe(
      (await ledger(s.adminCtx, { driver_id: s.driver.id })).totals.filteredSum,
    );
  });

  it('금액 미정과 승인 0원은 구분하고 취소 회차는 회차 수에서 제외한다', async () => {
    const s = await scenario(database().db);
    const unknown = await createUse(s.driverCtx, { ...s.input, billing_unit: 'PER_TON', quantity: '1' });
    const zero = await approved(s, {
      trips: [
        { seq: 1, origin: '상차', destination: '하차' },
        { seq: 2, origin: '상차', destination: '하차', status: 'CANCELED' },
      ],
    });
    await database()
      .db.update(chargeLines)
      .set({ approved_amount: 0, tax_amount: 0 })
      .where(eq(chargeLines.vehicle_use_id, zero.id));
    const result = await driverSettlements(s.driverCtx, period);
    expect(result.period_totals).toMatchObject({
      count: 2,
      trip_count: 2,
      approved_supply: 0,
      pending_supply: 0,
      unpriced_count: 1,
    });
    expect(result.uses.find((use) => use.id === unknown.id)).toMatchObject({
      unpriced_count: 1,
      pending_count: 1,
    });
    expect(result.uses.find((use) => use.id === zero.id)).toMatchObject({
      unpriced_count: 0,
      pending_count: 0,
      review_status: 'APPROVED',
    });
  });

  it('배정 밖 현장·회수된 현장·비활성 기사와 담당자 접근을 차단한다', async () => {
    const s = await scenario(database().db);
    const hiddenProject = await s.f.project({ name: '배정 밖 현장' });
    const hidden = await approved(s, { project_id: hiddenProject.id });
    await approved(s);
    expect(JSON.stringify(await driverSettlements(s.driverCtx, period))).not.toContain(hidden.id);
    await database()
      .db.update(projectAssignments)
      .set({ revoked_at: new Date() })
      .where(eq(projectAssignments.id, s.assignment.id));
    expect(await driverSettlements(s.driverCtx, period)).toMatchObject({
      uses: [],
      projects: [],
      dates: [],
      period_totals: { count: 0 },
    });
    await expect(driverSettlements(s.adminCtx, period)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await database().db.update(users).set({ status: 'DISABLED' }).where(eq(users.id, s.driverUser.id));
    await expect(driverSettlements(s.driverCtx, period)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('API는 날짜·역전·1년 초과를 422로 거부하고 윤년 한 해와 인증 경계를 검사한다', async () => {
    const s = await scenario(database().db);
    const session = await s.f.session(s.driverUser.id);
    for (const [start, end] of [
      ['2026-02-30', '2026-03-01'],
      ['2026-09-19', '2026-09-18'],
      ['2026-08-19', '2027-08-19'],
      ['', '2026-09-18'],
    ]) {
      const response = await callRoute(database().db, GET, {
        token: session.token,
        path: `/api/statements/mine?periodStart=${start}&periodEnd=${end}`,
      });
      expect(response.status).toBe(422);
    }
    const response = await callRoute(database().db, GET, {
      token: session.token,
      path: '/api/statements/mine?periodStart=2024-01-01&periodEnd=2024-12-31',
    });
    expect(response.status).toBe(200);
    expect((await response.json()).data.period_totals).toMatchObject({
      count: 0,
      approved_supply: 0,
      pending_supply: 0,
    });
    expect(
      (
        await callRoute(database().db, GET, {
          path: '/api/statements/mine?periodStart=2026-09-01&periodEnd=2026-09-30',
        })
      ).status,
    ).toBe(401);
  });
});
