import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { eq } from 'drizzle-orm';
import { expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { vehicleUses } from '../../src/server/db/schema';
import { createUse } from '../../src/server/services/uses';
import {
  cancelStatement,
  confirmStatement,
  getStatement,
  listStatements,
  statementCandidates,
} from '../../src/server/services/statements';
import { getLedger } from '../../src/server/services/ledger';
import { getDashboard } from '../../src/server/services/dashboard';
import { paymentOverview } from '../../src/server/services/payments';
import { statementExportModel, exportHeaders } from '../../src/server/export/statement-model';
import { renderStatementXlsx } from '../../src/server/export/statement-xlsx';
import { renderStatementPdf } from '../../src/server/export/statement-pdf';
import { PaymentPanel } from '../../src/app/m/payments/payment-panel';
import { StatementItems } from '../../src/app/m/statements/statement-items';
import { extractPdfText } from '../helpers/pdf';
import { testDatabase } from '../helpers/database';
import { approved, confirmed, draft, scenario } from './W4-fixtures';
vi.stubGlobal('React', React);
const database = testDatabase();

it('1. 취소 사용은 후보에서 제외하고 미제출은 요청한 경우에만 사유와 건수를 반환한다', async () => {
  const s = await scenario(database().db);
  const valid = await approved(s);
  const canceled = await approved(s);
  await s.adminCtx.db
    .update(vehicleUses)
    .set({ operation_status: 'CANCELED' })
    .where(eq(vehicleUses.id, canceled.id));
  const pending = await createUse(s.adminCtx, { ...s.input, billing_unit: 'PER_DAY' });
  const query = {
    direction: 'PAYABLE' as const,
    counterpartyId: s.payee.id,
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
  };
  const normal = await statementCandidates(s.adminCtx, query);
  expect(normal.rows.map((r) => r.snapshot.vehicle_use_id)).toEqual([valid.id]);
  expect(normal).toMatchObject({ unsubmitted_count: 1 });
  const expanded = await statementCandidates(s.adminCtx, { ...query, includeDrafts: 'true' } as Parameters<
    typeof statementCandidates
  >[1]);
  expect(expanded.rows.map((r) => r.snapshot.vehicle_use_id).sort()).toEqual([valid.id, pending.id].sort());
  expect(expanded.rows.find((r) => r.snapshot.vehicle_use_id === pending.id)).toMatchObject({
    eligible: false,
    reasons: expect.arrayContaining(['미제출 사용 건']),
  });
});

it('1. 초안 작성 뒤 취소된 사용은 확정 시 서버에서 재검사하고 잠금 없이 거부한다', async () => {
  const s = await scenario(database().db);
  const use = await approved(s);
  const statement = await draft(s, [use.charge_lines[0].id]);
  await s.adminCtx.db
    .update(vehicleUses)
    .set({ operation_status: 'CANCELED' })
    .where(eq(vehicleUses.id, use.id));
  await expect(
    confirmStatement(s.adminCtx, statement.id, {
      version: statement.version,
      confirmation_token: statement.confirmation_token!,
    }),
  ).rejects.toMatchObject({
    code: 'CONFIRM_BLOCKED',
    details: expect.arrayContaining([expect.objectContaining({ reason: '취소된 사용 건' })]),
  });
  expect((await getStatement(s.adminCtx, statement.id)).status).toBe('DRAFT');
});

it.each(['PAYABLE', 'RECEIVABLE'] as const)(
  '2. %s 목록·페이지 합계는 확정만 집계하고 취소 지급상태를 비운다',
  async (direction) => {
    const s = await scenario(database().db);
    const uses = await Promise.all([approved(s), approved(s), approved(s)]);
    // Both directions share the same statement aggregation; isolated fixtures model each direction.
    if (direction === 'RECEIVABLE') {
      const { chargeLines, counterparties } = await import('../../src/server/db/schema');
      await s.adminCtx.db
        .update(counterparties)
        .set({ kind: 'CUSTOMER' })
        .where(eq(counterparties.id, s.payee.id));
      for (const use of uses)
        await s.adminCtx.db
          .update(chargeLines)
          .set({ direction })
          .where(eq(chargeLines.vehicle_use_id, use.id));
    }
    const drafts = [];
    for (const use of uses) drafts.push(await draft(s, [use.charge_lines[0].id], { direction }));
    const valid = await confirmStatement(s.adminCtx, drafts[0].id, {
      version: drafts[0].version,
      confirmation_token: drafts[0].confirmation_token!,
    });
    const other = await confirmStatement(s.adminCtx, drafts[1].id, {
      version: drafts[1].version,
      confirmation_token: drafts[1].confirmation_token!,
    });
    await cancelStatement(s.adminCtx, other.id, { version: other.version, reason: '재작성' });
    const list = await listStatements(s.adminCtx, { direction, counterpartyId: s.payee.id });
    expect(list.totals).toEqual({ pageSum: 300000, filteredSum: 300000 });
    expect(list.rows.find((r) => r.id === other.id)?.payment_status).toBeNull();
    const canceledDetail = await getStatement(s.adminCtx, other.id);
    const markup = renderToStaticMarkup(
      createElement(PaymentPanel, { statement: canceledDetail, onChange: () => {} }),
    );
    expect(markup).toContain('—(취소됨)');
    expect(markup).not.toContain(direction === 'PAYABLE' ? '미지급' : '미입금');
    for (const status of ['DRAFT', 'CANCELED'] as const)
      expect(
        (await listStatements(s.adminCtx, { counterpartyId: s.payee.id, status })).totals.filteredSum,
      ).toBe(0);
    const overview = await paymentOverview(s.adminCtx, {
      direction,
      counterpartyId: s.payee.id,
      state: 'ALL',
    });
    expect(overview.rows.map((r) => r.id)).toEqual([valid.id]);
    expect(overview.totals.filteredSum).toBe(300000);
    if (direction === 'PAYABLE') {
      const manager = await s.f.user({ role: 'SETTLEMENT_MANAGER' });
      await s.f.assignment(manager.id, s.project.id);
      expect(await getDashboard(s.f.context(manager))).toMatchObject({
        unpaid_count: 1,
        unpaid_amount: 300000,
      });
    }
  },
);

it('4. 취소 사용은 대장에 상태를 보존하고 페이지·전체·내보내기 합계에서 제외한다', async () => {
  const s = await scenario(database().db);
  await approved(s);
  const canceled = await approved(s);
  await s.adminCtx.db
    .update(vehicleUses)
    .set({ operation_status: 'CANCELED' })
    .where(eq(vehicleUses.id, canceled.id));
  for (const all of [false, true]) {
    const ledger = await getLedger(s.adminCtx, { project_id: s.project.id }, all);
    expect(ledger.rows).toHaveLength(2);
    expect(ledger.totals).toEqual({ pageSum: 300000, filteredSum: 300000 });
  }
});

it('6. 확정 전후와 출력은 사용일·사용번호 순서가 같고 금액형 추가비 단가는 —이다', async () => {
  const s = await scenario(database().db);
  const first = await approved(s, {
    use_date: '2026-09-14',
    charge_lines: [{ charge_type: 'TOLL', requested_amount: 6600, reason: '통행' }],
  });
  const second = await approved(s);
  const third = await approved(s);
  const statement = await draft(s, [
    third.charge_lines[0].id,
    second.charge_lines[0].id,
    first.charge_lines[0].id,
  ]);
  const expected = [first.use_no, second.use_no, third.use_no];
  expect(statement.items.map((i) => i.snapshot?.use_no)).toEqual(expected);
  const final = await confirmStatement(s.adminCtx, statement.id, {
    version: statement.version,
    confirmation_token: statement.confirmation_token!,
  });
  expect(final.items.map((i) => i.snapshot?.use_no)).toEqual(expected);
  const toll = final.items.filter((i) => i.snapshot?.charge_type === 'TOLL');
  const markup = renderToStaticMarkup(createElement(StatementItems, { items: toll }));
  expect(markup).toContain('단가</span>—');
  expect(markup).not.toContain('미확정');
  expect((await statementExportModel(s.adminCtx, final.id)).rows.map((r) => r.use_no)).toEqual(expected);
});

it('7. Excel·PDF 비용 종류는 운반내용 바로 다음에 배치하고 숫자 서식을 유지한다', async () => {
  const s = await scenario(database().db);
  const use = await approved(s, { cargo_desc: '골재', quantity: '1.25' });
  const statement = await confirmed(s, [use.charge_lines[0].id]);
  const model = await statementExportModel(s.adminCtx, statement.id);
  expect(exportHeaders.slice(5, 10)).toEqual(['운반내용', '비용 종류', '운행수', '과금단위', '수량']);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await renderStatementXlsx(model)) as unknown as ExcelJS.Buffer);
  const sheet = book.worksheets[0];
  expect(sheet.getCell('G10').value).toBe('비용 종류');
  expect(sheet.getCell('G11').value).toBe('기본운임');
  expect(sheet.getCell('J11').value).toBe(1.25);
  expect(sheet.getCell('L11').value).toBe(375000);
  expect(sheet.getCell('L11').numFmt).toContain('원');
  const text = extractPdfText(await renderStatementPdf(model));
  expect(text).toMatch(/골재\s+기본운임\s+1\s+일대\s+1\.25\s+300,000\s+375,000/);
});
