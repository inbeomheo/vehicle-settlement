import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import Decimal from 'decimal.js';
import { rateAgreements, chargeLines, counterparties, projects } from '../db/schema';
import type { Context } from '../context';
import { accessibleProjectIds, assertCanSettle } from '../authz';
import { audit } from '../audit';
import { AppError, invalid, notFound } from '../errors';
import { adminTransaction } from './admin';
import { rateSchema, validateDates } from './admin-schemas';
import { uuid } from './schemas';

export async function listRates(ctx: Context) {
  await assertCanSettle(ctx);
  const ids = await accessibleProjectIds(ctx);
  return ctx.db
    .select()
    .from(rateAgreements)
    .where(
      ids === null
        ? undefined
        : sql`(${rateAgreements.project_id} IS NULL OR ${ids.length ? inArray(rateAgreements.project_id, ids) : sql`false`})`,
    )
    .orderBy(rateAgreements.name, rateAgreements.valid_from);
}
type Rate = z.output<typeof rateSchema>;
const priceFields = [
  'direction',
  'counterparty_id',
  'project_id',
  'vehicle_type',
  'tonnage',
  'billing_unit',
  'unit_price',
  'valid_from',
  'valid_to',
  'tax_mode',
  'rounding',
  'min_charge',
] as const;
async function validateRate(ctx: Context, input: Rate, exclude?: string) {
  validateDates(input);
  const [party] = await ctx.db
    .select()
    .from(counterparties)
    .where(eq(counterparties.id, input.counterparty_id));
  if (!party || (input.direction === 'PAYABLE' ? party.kind === 'CUSTOMER' : party.kind !== 'CUSTOMER'))
    invalid('지급/청구 방향에 맞는 거래처를 선택하세요.');
  const [previous] = exclude
    ? await ctx.db.select().from(rateAgreements).where(eq(rateAgreements.id, exclude))
    : [];
  if (!party.active && previous?.counterparty_id !== input.counterparty_id)
    invalid('사용 중인 거래처를 선택하세요.');
  if (input.project_id && previous?.project_id !== input.project_id) {
    const [project] = await ctx.db.select().from(projects).where(eq(projects.id, input.project_id));
    if (!project?.active) invalid('사용 중인 현장을 선택하세요.');
  }
  const overlapping = await ctx.db
    .execute(sql`SELECT id FROM rate_agreements WHERE id IS DISTINCT FROM ${exclude ?? null}::uuid
    AND direction=${input.direction} AND counterparty_id=${input.counterparty_id}::uuid
    AND project_id IS NOT DISTINCT FROM ${input.project_id}::uuid
    AND vehicle_type IS NOT DISTINCT FROM ${input.vehicle_type}::text
    AND tonnage IS NOT DISTINCT FROM ${input.tonnage}::numeric AND billing_unit=${input.billing_unit}
    AND valid_from <= COALESCE(${input.valid_to}::date,'infinity'::date)
    AND COALESCE(valid_to,'infinity'::date) >= ${input.valid_from}::date`);
  if (overlapping.rows.length)
    invalid('같은 조건의 계약 적용기간이 겹칩니다. 새 적용기간 추가를 사용하세요.');
}
export async function saveRate(ctx: Context, raw: unknown, id?: string) {
  if (id) uuid.parse(id);
  return adminTransaction(ctx, async (tx) => {
    // W1 reads rates inside the use transaction. Wait for those reads/inserts to finish
    // before changing price periods, so an in-flight use cannot reference a closed period.
    await tx.db.execute(sql`LOCK TABLE rate_agreements IN ACCESS EXCLUSIVE MODE`);
    const [before] = id
      ? await tx.db.select().from(rateAgreements).where(eq(rateAgreements.id, id)).for('update')
      : [];
    if (id && !before) notFound();
    const patch = id
      ? rateSchema.partial().extend({ version: z.number().int().positive() }).strict().parse(raw)
      : undefined;
    if (before && before.version !== patch!.version)
      throw new AppError('VERSION_CONFLICT', '계약 정보가 변경되었습니다. 새로고침하세요.');
    const fields = Object.fromEntries(
      Object.keys(rateSchema.shape).map((key) => [key, before?.[key as keyof typeof before]]),
    );
    const input = rateSchema.parse(
      id
        ? {
            ...fields,
            ...Object.fromEntries(
              Object.entries(patch!).filter(
                ([key]) => key !== 'version' && Object.hasOwn(raw as object, key),
              ),
            ),
          }
        : raw,
    );
    if (before) {
      const referenced = await tx.db
        .select({ id: chargeLines.id })
        .from(chargeLines)
        .where(eq(chargeLines.rate_agreement_id, before.id))
        .limit(1);
      if (
        referenced.length &&
        priceFields.some(
          (key) =>
            input[key] !== before[key] &&
            !(
              key === 'tonnage' &&
              input[key] != null &&
              before[key] != null &&
              new Decimal(input[key]).eq(before[key])
            ),
        )
      )
        invalid('이미 사용된 계약의 가격 조건은 수정할 수 없습니다. 새 적용기간을 추가하세요.');
    }
    await validateRate(tx, input, id);
    const [after] = id
      ? await tx.db
          .update(rateAgreements)
          .set({ ...input, version: before!.version + 1, updated_at: new Date() })
          .where(eq(rateAgreements.id, id))
          .returning()
      : await tx.db.insert(rateAgreements).values(input).returning();
    await audit(tx, id ? 'UPDATE_RATE' : 'CREATE_RATE', 'rate_agreement', after.id, before, after);
    return after;
  });
}
const periodSchema = rateSchema
  .pick({
    name: true,
    valid_from: true,
    valid_to: true,
    unit_price: true,
    tax_mode: true,
    rounding: true,
    min_charge: true,
    notes: true,
  })
  .partial()
  .extend({
    version: z.number().int().positive(),
    valid_from: rateSchema.shape.valid_from,
    unit_price: rateSchema.shape.unit_price,
  })
  .strict();
export async function addRatePeriod(ctx: Context, id: string, raw: unknown) {
  uuid.parse(id);
  const patch = periodSchema.parse(raw);
  return adminTransaction(ctx, async (tx) => {
    // W1 reads rates inside the use transaction. Wait for those reads/inserts to finish
    // before changing price periods, so an in-flight use cannot reference a closed period.
    await tx.db.execute(sql`LOCK TABLE rate_agreements IN ACCESS EXCLUSIVE MODE`);
    const [before] = await tx.db.select().from(rateAgreements).where(eq(rateAgreements.id, id)).for('update');
    if (!before) notFound();
    if (before.version !== patch.version)
      throw new AppError('VERSION_CONFLICT', '계약 정보가 변경되었습니다. 새로고침하세요.');
    if (patch.valid_from <= before.valid_from) invalid('새 적용 시작일은 기존 시작일 이후여야 합니다.');
    const previousDay = new Date(`${patch.valid_from}T00:00:00Z`);
    previousDay.setUTCDate(previousDay.getUTCDate() - 1);
    const end = previousDay.toISOString().slice(0, 10);
    const referencesAfter = await tx.db
      .select({ id: chargeLines.id })
      .from(chargeLines)
      .where(and(eq(chargeLines.rate_agreement_id, id), sql`${chargeLines.rate_basis_date} > ${end}::date`))
      .limit(1);
    if (referencesAfter.length)
      invalid('새 시작일 이후 기존 계약을 사용한 비용이 있습니다. 더 늦은 시작일을 선택하세요.');
    if (!before.valid_to || before.valid_to > end) {
      const [closed] = await tx.db
        .update(rateAgreements)
        .set({ valid_to: end, version: before.version + 1, updated_at: new Date() })
        .where(eq(rateAgreements.id, id))
        .returning();
      await audit(tx, 'CLOSE_RATE_PERIOD', 'rate_agreement', id, before, closed);
    }
    const fields = Object.fromEntries(
      Object.keys(rateSchema.shape).map((key) => [key, before[key as keyof typeof before]]),
    );
    const changes = Object.fromEntries(
      Object.entries(patch).filter(([key]) => key !== 'version' && Object.hasOwn(raw as object, key)),
    );
    const input = rateSchema.parse({ ...fields, valid_to: null, ...changes, active: true });
    await validateRate(tx, input);
    const [after] = await tx.db.insert(rateAgreements).values(input).returning();
    await audit(tx, 'ADD_RATE_PERIOD', 'rate_agreement', after.id, null, after, `이전 계약: ${id}`);
    return after;
  });
}
