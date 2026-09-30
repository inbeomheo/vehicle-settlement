import { sql } from 'drizzle-orm';
import type { Context } from '../context';
import { assertActive, assertAdmin } from '../authz';

/**
 * 관리자 첫 사용 체크리스트: 운행을 받기 전에 등록해야 할 기준정보가 있는지.
 * 모두 채워지면 대시보드에서 사라진다.
 */
export async function getSetupStatus(ctx: Context) {
  await assertActive(ctx);
  assertAdmin(ctx);
  const result = await ctx.db.execute<Record<string, number>>(sql`SELECT
    (SELECT count(*)::int FROM company_settings) AS company,
    (SELECT count(*)::int FROM projects WHERE active) AS projects,
    (SELECT count(*)::int FROM vehicles WHERE active) AS vehicles,
    (SELECT count(*)::int FROM counterparties WHERE active AND kind <> 'CUSTOMER') AS payees,
    (SELECT count(*)::int FROM drivers WHERE active) AS drivers,
    (SELECT count(*)::int FROM driver_affiliations) AS affiliations,
    (SELECT count(*)::int FROM rate_agreements WHERE direction = 'PAYABLE') AS rates,
    (SELECT count(*)::int FROM users WHERE role <> 'ADMIN') + (SELECT count(*)::int FROM invites WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > now()) AS people`);
  const row = result.rows[0];
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
}
