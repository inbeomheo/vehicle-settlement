import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../../src/server/db/client';
import { chargeLines, rateAgreements } from '../../src/server/db/schema';
import { setupScenario } from '../helpers/factories';
import { createUse, submitUse, approveUse } from '../../src/server/services/uses';
import type { CreateUseInput } from '../../src/server/services/schemas';
import { createStatement, confirmStatement } from '../../src/server/services/statements';
export async function scenario(db: Db) {
  const s = await setupScenario(db);
  await db.update(rateAgreements).set({ tax_mode: 'TAX_EXEMPT' }).where(eq(rateAgreements.id, s.rate.id));
  return s;
}
export async function approved(
  s: Awaited<ReturnType<typeof scenario>>,
  overrides: Partial<CreateUseInput> = {},
  taxMode?: 'TAX_EXEMPT' | 'VAT_INCLUDED' | 'VAT_EXCLUDED',
) {
  const use = await createUse(s.adminCtx, {
    ...s.input,
    billing_unit: 'PER_DAY',
    client_request_id: randomUUID(),
    ...overrides,
  });
  if (taxMode)
    await s.adminCtx.db
      .update(chargeLines)
      .set({ tax_mode: taxMode })
      .where(eq(chargeLines.vehicle_use_id, use.id));
  const submitted = await submitUse(s.adminCtx, use.id, { version: use.version });
  return approveUse(s.adminCtx, use.id, { version: submitted.version });
}
export async function draft(
  s: Awaited<ReturnType<typeof scenario>>,
  ids: string[],
  overrides: Partial<Parameters<typeof createStatement>[1]> = {},
) {
  return createStatement(s.adminCtx, {
    client_request_id: randomUUID(),
    direction: 'PAYABLE',
    counterparty_id: s.payee.id,
    period_start: '2026-09-01',
    period_end: '2026-09-30',
    items: ids.map((charge_line_id) => ({ charge_line_id })),
    ...overrides,
  });
}
export async function confirmed(s: Awaited<ReturnType<typeof scenario>>, ids: string[]) {
  const statement = await draft(s, ids);
  return confirmStatement(s.adminCtx, statement.id, {
    confirmation_token: statement.confirmation_token!,
    version: statement.version,
  });
}
