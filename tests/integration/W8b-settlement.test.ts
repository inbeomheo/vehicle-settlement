import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { mkdir, writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { chargeLines, statementItems } from '../../src/server/db/schema';
import { statementCandidates, getStatement, confirmStatement } from '../../src/server/services/statements';
import { paymentOverview, recordPayment } from '../../src/server/services/payments';
import { createAdjustment } from '../../src/server/services/adjustments';
import { exportHeaders, rowValues, statementExportModel } from '../../src/server/export/statement-model';
import { renderStatementXlsx } from '../../src/server/export/statement-xlsx';
import { renderStatementPdf } from '../../src/server/export/statement-pdf';
import { StatementItems } from '../../src/app/m/statements/statement-items';
import { chargeTypeLabel, chargeUnitLabel } from '../../src/components/manager/charge-display';
import { testDatabase } from '../helpers/database';
import { approved, confirmed, draft, scenario } from './W4-fixtures';

vi.stubGlobal('React', React);
const database = testDatabase();
const extraTypes = ['WAITING', 'TOLL', 'EXTRA_STOP', 'CANCEL_FEE', 'EXPENSE', 'OTHER'] as const;

describe('W8b 비용 종류와 확정 출력', () => {
  it('후보·확정 snapshot·화면·Excel/PDF는 같은 비용 종류/단위를 표시하고 금액을 보존한다', async () => {
    const s = await scenario(database().db);
    const use = await approved(
      s,
      {
        charge_lines: [
          { charge_type: 'BASE', billing_unit: 'PER_DAY' },
          ...extraTypes.map((charge_type) => ({
            charge_type,
            billing_unit: 'PER_DAY' as const,
            requested_amount: 1000,
            reason: '현장 추가비',
          })),
        ],
      },
      'TAX_EXEMPT',
    );
    const candidates = await statementCandidates(s.adminCtx, {
      direction: 'PAYABLE',
      counterpartyId: s.payee.id,
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
    });
    expect(candidates.rows.map((row) => row.snapshot.charge_type).sort()).toEqual(
      ['BASE', ...extraTypes].sort(),
    );
    const statement = await confirmed(
      s,
      use.charge_lines.map((line) => line.id),
    );
    const model = await statementExportModel(s.adminCtx, statement.id);
    const markup = renderToStaticMarkup(createElement(StatementItems, { items: statement.items }));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await renderStatementXlsx(model)) as unknown as ExcelJS.Buffer);
    const sheet = workbook.worksheets[0];
    expect(sheet.getCell('N10').value).toBe('비용 종류');
    expect(model.grand_total).toBe(306000);
    for (const [index, row] of model.rows.entries()) {
      const values = rowValues(row);
      expect(values[exportHeaders.indexOf('비용 종류')]).toBe(chargeTypeLabel(row.charge_type));
      expect(values[7]).toBe(chargeUnitLabel(row.charge_type, row.billing_unit));
      expect(values[7]).toBe(row.charge_type === 'BASE' ? '일대' : '건');
      expect(sheet.getCell(index + 11, 14).value).toBe(chargeTypeLabel(row.charge_type));
      expect(sheet.getCell(index + 11, 8).value).toBe(values[7]);
      expect(markup).toContain(chargeTypeLabel(row.charge_type));
    }
    const pdf = await renderStatementPdf(model);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    if (process.env.W8B_RENDER_QA) {
      await mkdir('.data/w8b-qa', { recursive: true });
      await writeFile('.data/w8b-qa/charge-types.pdf', pdf);
    }
    await database()
      .db.update(chargeLines)
      .set({ charge_type: 'OTHER', billing_unit: 'MONTHLY', approved_amount: 999 })
      .where(eq(chargeLines.id, use.charge_lines[0].id));
    expect(await statementExportModel(s.adminCtx, statement.id)).toEqual(model);
  });

  it('charge_type이 없는 기존 확정 snapshot은 종류 —로 표시하고 원본과 금액을 바꾸지 않는다', async () => {
    const s = await scenario(database().db);
    const use = await approved(s);
    const statement = await confirmed(s, [use.charge_lines[0].id]);
    const snapshot = { ...statement.items[0].snapshot };
    delete snapshot.charge_type;
    await database()
      .db.update(statementItems)
      .set({ snapshot })
      .where(eq(statementItems.id, statement.items[0].id));
    const model = await statementExportModel(s.adminCtx, statement.id);
    expect(rowValues(model.rows[0])[13]).toBe('—');
    expect(rowValues(model.rows[0])[7]).toBe('일대');
    expect(model.grand_total).toBe(300000);
    const current = await getStatement(s.adminCtx, statement.id);
    expect(current.items[0].snapshot).toEqual(snapshot);
    const markup = renderToStaticMarkup(createElement(StatementItems, { items: current.items }));
    expect(markup).toContain('비용 종류</span>—');
    const [stored] = await database()
      .db.select()
      .from(statementItems)
      .where(eq(statementItems.id, statement.items[0].id));
    expect(stored.snapshot).toEqual(snapshot);
  });

  it('조정 비용은 다음 명세에서 조정/건으로 표시하며 원명세 합계는 유지한다', async () => {
    const s = await scenario(database().db);
    const use = await approved(s);
    const original = await confirmed(s, [use.charge_lines[0].id]);
    await recordPayment(s.adminCtx, original.id, {
      client_request_id: crypto.randomUUID(),
      kind: 'PAYMENT',
      amount: original.grand_total,
      paid_on: '2026-09-29',
      method: '계좌이체',
    });
    const adjustment = await createAdjustment(s.adminCtx, {
      adjusts_statement_id: original.id,
      charge_line_id: use.charge_lines[0].id,
      supply_amount: -1000,
      reason: '과다 청구 정정',
      effective_date: '2026-10-01',
    });
    const nextDraft = await draft(s, [adjustment.id], {
      period_start: '2026-10-01',
      period_end: '2026-10-31',
    });
    const next = await confirmStatement(s.adminCtx, nextDraft.id, { version: nextDraft.version });
    const model = await statementExportModel(s.adminCtx, next.id);
    expect(rowValues(model.rows[0])[13]).toBe('조정');
    expect(rowValues(model.rows[0])[7]).toBe('건');
    expect((await getStatement(s.adminCtx, original.id)).grand_total).toBe(300000);
  });

  it('지급 완료와 전체 필터도 해당 거래처·현장 합계를 집계하고 미지급 집계는 별도로 보존한다', async () => {
    const s = await scenario(database().db);
    const paidUse = await approved(s);
    const unpaidUse = await approved(s);
    const paid = await confirmed(s, [paidUse.charge_lines[0].id]);
    await confirmed(s, [unpaidUse.charge_lines[0].id]);
    await recordPayment(s.adminCtx, paid.id, {
      client_request_id: crypto.randomUUID(),
      kind: 'PAYMENT',
      amount: paid.grand_total,
      paid_on: '2026-09-29',
      method: '계좌이체',
    });
    const paidOverview = await paymentOverview(s.adminCtx, { counterpartyId: s.payee.id, state: 'PAID' });
    expect(paidOverview.groups).toMatchObject([
      { count: 1, amount: 300000, unpaid_count: 0, unpaid_amount: 0 },
    ]);
    const all = await paymentOverview(s.adminCtx, { counterpartyId: s.payee.id, state: 'ALL' });
    expect(all.groups).toMatchObject([{ count: 2, amount: 600000, unpaid_count: 1, unpaid_amount: 300000 }]);
    const unpaid = await paymentOverview(s.adminCtx, { counterpartyId: s.payee.id, state: 'UNPAID' });
    expect(unpaid.groups).toMatchObject([
      { count: 1, amount: 300000, unpaid_count: 1, unpaid_amount: 300000 },
    ]);
  });
});
