import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDatabase } from '../helpers/database';
import { callRoute } from '../helpers/routes';
import { approved, draft, scenario } from './W4-fixtures';
import { approveUse, updateUse } from '../../src/server/services/uses';
import { getStatement } from '../../src/server/services/statements';
import { chargeLines } from '../../src/server/db/schema';
import { POST } from '../../src/app/api/statements/[id]/confirm/route';

const database = testDatabase();

it('초안 확인 뒤 금액 수정·재승인하면 이전 토큰을 409로 거부하고 최신 합계를 반환한다', async () => {
  const s = await scenario(database().db);
  const use = await approved(s);
  const shown = await draft(s, [use.charge_lines[0].id]);
  const { token } = await s.f.session(s.admin.id);
  const request = (body: unknown) =>
    callRoute(database().db, POST, {
      method: 'POST',
      path: `/api/statements/${shown.id}/confirm`,
      params: { id: shown.id },
      token,
      body,
      headers: { 'idempotency-key': crypto.randomUUID() },
    });
  const changed = await updateUse(s.adminCtx, use.id, {
    version: use.version,
    charge_lines: [
      { id: use.charge_lines[0].id, charge_type: 'BASE', billing_unit: 'PER_DAY', quantity: '2' },
    ],
  });
  await approveUse(s.adminCtx, use.id, { version: changed.version });
  const oldToken = shown.confirmation_token;
  const rejected = await request({ version: shown.version, confirmation_token: oldToken });
  expect(rejected.status).toBe(409);
  expect(await rejected.json()).toMatchObject({
    error: {
      code: 'STATEMENT_CHANGED',
      details: { supply_total: 600000, tax_total: 0, grand_total: 600000 },
    },
  });
  const fresh = await getStatement(s.adminCtx, shown.id);
  expect(fresh.status).toBe('DRAFT');
  expect(fresh.version).toBe(shown.version);
  expect(shown.grand_total).toBe(300000);
  expect(
    (await database().db.select().from(chargeLines).where(eq(chargeLines.id, use.charge_lines[0].id)))[0]
      .locked_statement_id,
  ).toBeNull();
  const freshToken = fresh.confirmation_token;
  expect(freshToken).toMatch(/^[a-f0-9]{64}$/);
  expect(freshToken).not.toBe(oldToken);
  expect((await request({ version: fresh.version, confirmation_token: freshToken })).status).toBe(200);
});

it('확인 토큰 없는 확정은 거부한다', async () => {
  const s = await scenario(database().db);
  const use = await approved(s);
  const statement = await draft(s, [use.charge_lines[0].id]);
  const { token } = await s.f.session(s.admin.id);
  const response = await callRoute(database().db, POST, {
    method: 'POST',
    path: `/api/statements/${statement.id}/confirm`,
    params: { id: statement.id },
    token,
    body: { version: statement.version },
  });
  expect(response.status).toBe(422);
  expect((await getStatement(s.adminCtx, statement.id)).status).toBe('DRAFT');
});

it.each(['version', 'amounts', 'tax'] as const)(
  '라인 %s 변경은 합계만 비교하여 놓치지 않는다',
  async (change) => {
    const s = await scenario(database().db);
    const use = await approved(s, {
      charge_lines: [
        { charge_type: 'WAITING', requested_amount: 1000, reason: '대기' },
        { charge_type: 'TOLL', requested_amount: 2000, reason: '통행료' },
      ],
    });
    const shown = await draft(
      s,
      use.charge_lines.map((line) => line.id),
    );
    const [first, second] = use.charge_lines;
    if (change === 'version') {
      await database()
        .db.update(chargeLines)
        .set({ version: first.version + 1 })
        .where(eq(chargeLines.id, first.id));
    } else {
      const field = change === 'amounts' ? 'approved_amount' : 'tax_amount';
      await database()
        .db.update(chargeLines)
        .set({ [field]: first[field]! + 100 })
        .where(eq(chargeLines.id, first.id));
      await database()
        .db.update(chargeLines)
        .set({ [field]: second[field]! - 100 })
        .where(eq(chargeLines.id, second.id));
    }
    expect((await getStatement(s.adminCtx, shown.id)).grand_total).toBe(shown.grand_total);
    const { token } = await s.f.session(s.admin.id);
    const response = await callRoute(database().db, POST, {
      method: 'POST',
      path: `/api/statements/${shown.id}/confirm`,
      params: { id: shown.id },
      token,
      body: { version: shown.version, confirmation_token: shown.confirmation_token },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'STATEMENT_CHANGED' } });
  },
);
