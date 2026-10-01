import { eq, sql } from 'drizzle-orm';
import type { Context } from '../context';
import type { Db } from '../db/client';
import { counterparties } from '../db/schema';
import { audit } from '../audit';
import { invalid } from '../errors';

export async function approvedJoinBusiness(db: Db, id: string) {
  const [party] = await db.select().from(counterparties).where(eq(counterparties.id, id)).for('update');
  if (!party?.active || !['DRIVER_BUSINESS', 'CARRIER'].includes(party.kind))
    invalid('사용 중인 기사 사업자 또는 운송사를 선택하세요. 소속 사업자를 관리자에게 확인해 주세요.');
  return party;
}
// Called only within the administrator transaction and shared identity lock.
export async function resolveJoinBusiness(
  ctx: Context,
  input: {
    counterparty_id?: string | null;
    new_business?: { name: string; biz_no: string };
  },
) {
  if (input.counterparty_id && input.new_business) invalid('기존 사업자와 새 사업자 중 하나만 지정하세요.');
  if (input.counterparty_id) return (await approvedJoinBusiness(ctx.db, input.counterparty_id)).id;
  if (!input.new_business) return null;
  const existing = await ctx.db
    .select({ id: counterparties.id })
    .from(counterparties)
    .where(
      sql`regexp_replace(${counterparties.biz_no}, '[^0-9]', '', 'g')=${input.new_business.biz_no.replaceAll('-', '')}`,
    )
    .limit(1);
  if (existing.length) invalid('이미 등록된 사업자번호예요. 기존 사업자 선택에서 골라 주세요.');
  const [party] = await ctx.db
    .insert(counterparties)
    .values({ ...input.new_business, kind: 'DRIVER_BUSINESS' })
    .returning();
  await audit(ctx, 'CREATE', 'counterparties', party.id, null, party);
  return party.id;
}
export async function joinBusinessSummary(db: Db, id: string | null) {
  if (!id) return null;
  const [party] = await db
    .select({
      name: counterparties.name,
      biz_no: counterparties.biz_no,
      active: counterparties.active,
      kind: counterparties.kind,
    })
    .from(counterparties)
    .where(eq(counterparties.id, id));
  if (!party?.active || !['DRIVER_BUSINESS', 'CARRIER'].includes(party.kind)) return null;
  const digits = party.biz_no?.replace(/\D/g, '') ?? '';
  return {
    name: party.name,
    masked_biz_no:
      digits.length === 10 ? `${digits.slice(0, 3)}-**-***${digits.slice(-2)}` : '사업자번호 미등록',
  };
}
