import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { chargeLines, statementItems } from '../../src/server/db/schema';
import { confirmStatement, getStatement, listStatements } from '../../src/server/services/statements';
import { statementExportModel } from '../../src/server/export/statement-model';
import { renderStatementXlsx } from '../../src/server/export/statement-xlsx';
import ExcelJS from 'exceljs';
import { testDatabase } from '../helpers/database';
import { approved, confirmed, draft, scenario } from './W4-fixtures';
const database = testDatabase();
it('부분 유니크 최종 방어 실패도 CONFIRM_BLOCKED이며 조건부 잠금 UPDATE까지 모두 롤백', async () => {
  const s = await scenario(database().db);
  const use = await approved(s);
  const first = await draft(
    s,
    use.charge_lines.map((l) => l.id),
  );
  const other = await draft(
    s,
    use.charge_lines.map((l) => l.id),
  );
  // Deliberately inconsistent legacy row: validate the final database defense.
  await database()
    .db.update(statementItems)
    .set({ is_active_lock: true })
    .where(eq(statementItems.statement_id, other.id));
  await expect(
    confirmStatement(s.adminCtx, first.id, { confirmation_token: first.confirmation_token!, version: 1 }),
  ).rejects.toMatchObject({
    code: 'CONFIRM_BLOCKED',
  });
  const [line] = await database()
    .db.select()
    .from(chargeLines)
    .where(eq(chargeLines.id, use.charge_lines[0].id));
  expect(line.locked_statement_id).toBeNull();
  expect((await getStatement(s.adminCtx, first.id)).status).toBe('DRAFT');
});
it('현장 하나라도 권한 밖이면 혼합 명세 전체를 숨기고 현장 담당자도 명세 접근 불가', async () => {
  const s = await scenario(database().db);
  const project2 = await s.f.project();
  const own = await approved(s);
  const other = await approved(s, { project_id: project2.id });
  const statement = await confirmed(
    s,
    [...own.charge_lines, ...other.charge_lines].map((l) => l.id),
  );
  const manager = await s.f.user({ role: 'SETTLEMENT_MANAGER' });
  await s.f.assignment(manager.id, s.project.id);
  const ctx = s.f.context(manager);
  await expect(getStatement(ctx, statement.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect((await listStatements(ctx, {})).total).toBe(0);
  const site = await s.f.user({ role: 'SITE_MANAGER' });
  await s.f.assignment(site.id, s.project.id);
  await expect(getStatement(s.f.context(site), statement.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
it('세액은 각 라인 5원의 1원씩 합산하며 화면·엑셀·PDF 입력이 모두 12원으로 일치', async () => {
  const s = await scenario(database().db);
  const use = await approved(s, {
    charge_lines: [
      { charge_type: 'WAITING', requested_amount: 5, reason: '대기비' },
      { charge_type: 'TOLL', requested_amount: 5, reason: '통행료' },
    ],
  });
  const statement = await confirmed(
    s,
    use.charge_lines.map((l) => l.id),
  );
  expect(statement).toMatchObject({ supply_total: 10, tax_total: 2, grand_total: 12 });
  const model = await statementExportModel(s.adminCtx, statement.id);
  expect(model).toMatchObject({ supply_total: 10, tax_total: 2, grand_total: 12 });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    (await renderStatementXlsx(model)) as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  const sheet = workbook.worksheets[0];
  expect(sheet.getCell('K11').value).toBe(5);
  expect(sheet.getCell('K12').value).toBe(5);
  expect(sheet.getCell('L11').value).toBe(1);
  expect(sheet.getCell('L12').value).toBe(1);
});
it('거래처 변조를 확정 시 재검사하고 정상 라인까지 잠그지 않음', async () => {
  const s = await scenario(database().db);
  const use = await approved(s);
  const use2 = await approved(s);
  const statement = await draft(
    s,
    [...use.charge_lines, ...use2.charge_lines].map((l) => l.id),
  );
  const party = await s.f.counterparty({ name: randomUUID() });
  await database()
    .db.update(chargeLines)
    .set({ counterparty_id: party.id })
    .where(eq(chargeLines.id, use.charge_lines[0].id));
  await expect(
    confirmStatement(s.adminCtx, statement.id, {
      confirmation_token: statement.confirmation_token!,
      version: 1,
    }),
  ).rejects.toMatchObject({
    code: 'CONFIRM_BLOCKED',
    details: expect.arrayContaining([expect.objectContaining({ reason: '방향 또는 거래처 불일치' })]),
  });
  const [line] = await database()
    .db.select()
    .from(chargeLines)
    .where(eq(chargeLines.id, use2.charge_lines[0].id));
  expect(line.locked_statement_id).toBeNull();
});
