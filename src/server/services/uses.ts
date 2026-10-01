import { validateReviewer } from './use-reviewers';
import { proposedAmount } from '../../shared/charge-amount';
import { proposedAmountSql } from './charge-amount-sql';
import { routeSummary } from '../domain/route-summary';
import { createHash } from 'node:crypto';
import { fixTargetBlockedReason, requiredFieldErrors } from '../../shared/form-settings';
import { getEffectiveFormSettings } from './form-settings';
import { and, asc, desc, eq, ne, inArray, isNull, lte, gte, or, ilike, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  chargeLines,
  counterparties,
  driverAffiliations,
  drivers,
  evidence,
  projects,
  trips,
  useRevisions,
  vehicleUses,
  vehicles,
  workTypes,
  users,
} from '../db/schema';
import type { Context } from '../context';
import { todaySeoul } from '../context';
import {
  assertActive,
  assertCanEditUse,
  assertCanReadUse,
  assertCanReview,
  assertProjectAccess,
  canSeeReceivable,
  redactForDriver,
  accessibleUseFilter,
  driverEvidenceFilter,
} from '../authz';
import { AppError, invalid, notFound } from '../errors';
import { audit } from '../audit';
import { nextUseNo } from '../db/numbers';
import { calculateTax, computeAmount, sumMoney, taxFromSupply } from '../domain/money';
import { assertTransition, reviewAfterEdit } from '../domain/states';
import { findRate } from './rates';
import {
  approveSchema,
  copySchema,
  createUseSchema,
  fixSchema,
  lineDecision,
  listUsesSchema,
  reasonSchema,
  updateUseSchema,
  versionInput,
  type ChargeInput,
  type CreateUseInput,
  type UpdateUseInput,
} from './schemas';
export type Use = typeof vehicleUses.$inferSelect;
export type Charge = typeof chargeLines.$inferSelect;
export async function atomic<T>(ctx: Context, fn: (ctx: Context) => Promise<T>): Promise<T> {
  return ctx.db.transaction(async (db) => {
    const tx = { ...ctx, db };
    await assertActive(tx);
    return fn(tx);
  });
}
export async function rawUse(ctx: Context, id: string, lock = false) {
  const query = ctx.db.select().from(vehicleUses).where(eq(vehicleUses.id, id));
  const [use] = await (lock ? query.for('update') : query);
  if (!use) notFound();
  await assertCanReadUse(ctx, use);
  return use;
}
export async function rawDetail(ctx: Context, use: Use) {
  const [creator] = await ctx.db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, use.created_by_user_id));
  const tripRows = await ctx.db
    .select()
    .from(trips)
    .where(eq(trips.vehicle_use_id, use.id))
    .orderBy(asc(trips.seq));
  const lines = await ctx.db
    .select()
    .from(chargeLines)
    .where(and(eq(chargeLines.vehicle_use_id, use.id), isNull(chargeLines.deleted_at)))
    .orderBy(asc(chargeLines.created_at), asc(chargeLines.id));
  const files = await ctx.db
    .select()
    .from(evidence)
    .where(
      and(eq(evidence.vehicle_use_id, use.id), isNull(evidence.deleted_at), isNull(evidence.replaced_by_id)),
    );
  const revisions = await ctx.db
    .select()
    .from(useRevisions)
    .where(eq(useRevisions.vehicle_use_id, use.id))
    .orderBy(desc(useRevisions.revision_no));
  const duplicateHint = tripRows.some((t, i) =>
    tripRows.some((s, j) => j < i && t.origin === s.origin && t.destination === s.destination),
  );
  const { create_request_hash: _hash, ...publicUse } = use;
  void _hash;
  return {
    ...publicUse,
    created_by_name: creator?.name ?? '알 수 없음',
    trips: tripRows,
    charge_lines: lines,
    evidence: files.map(({ storage_key: _key, ...file }) => {
      void _key;
      return file;
    }),
    revisions,
    duplicate_hint: duplicateHint,
    is_locked: lines.some((line) => line.locked_statement_id !== null),
  };
}
async function publicDetail(ctx: Context, detail: Awaited<ReturnType<typeof rawDetail>>) {
  const hidden =
    ctx.user.role === 'DRIVER'
      ? await ctx.db
          .select()
          .from(evidence)
          .where(and(eq(evidence.vehicle_use_id, detail.id), sql`NOT (${driverEvidenceFilter(ctx)})`))
      : [];
  const currentHidden = hidden.filter((file) => !file.deleted_at && !file.replaced_by_id);
  const [project] = currentHidden.length
    ? await ctx.db
        .select({ evidence_policy: projects.evidence_policy })
        .from(projects)
        .where(eq(projects.id, detail.project_id))
    : [];
  return redactForDriver(
    ctx,
    {
      ...detail,
      restricted_evidence_count: currentHidden.length,
      restricted_evidence_satisfies_policy: Boolean(
        project && evidenceSatisfiesPolicy(project.evidence_policy, currentHidden),
      ),
    },
    new Set(hidden.map((file) => file.id)),
  );
}
export async function getUse(ctx: Context, id: string) {
  return publicDetail(ctx, await rawDetail(ctx, await rawUse(ctx, id)));
}
export function assertVersion(use: Use, version: number) {
  if (use.version !== version)
    throw new AppError('VERSION_CONFLICT', '다른 사용자가 수정했습니다. 최신 내용을 확인하세요.', {
      current_version: use.version,
    });
}
// Lock every cost row before checking: a concurrent statement confirmation may have
// acquired its charge lock but not written locked_statement_id yet.
export async function assertUnlocked(ctx: Context, id: string) {
  const lines = await ctx.db
    .select({ locked_statement_id: chargeLines.locked_statement_id })
    .from(chargeLines)
    .where(eq(chargeLines.vehicle_use_id, id))
    .orderBy(asc(chargeLines.id))
    .for('update');
  if (lines.some((line) => line.locked_statement_id !== null))
    throw new AppError(
      'STATEMENT_LOCKED',
      ctx.user.role === 'DRIVER'
        ? '정산 확정된 운행입니다. 수정이 필요하면 담당자에게 문의하세요'
        : '확정 명세를 취소한 후 수정하세요.',
    );
}
function evidenceSatisfiesPolicy(policy: string, files: (typeof evidence.$inferSelect)[]) {
  const uploaded = files.filter((file) => file.upload_status === 'UPLOADED');
  const hasFile = uploaded.some(
    (file) => file.storage_key && ['PHOTO', 'RECEIPT', 'WEIGH_TICKET', 'CONFIRMATION'].includes(file.kind),
  );
  const alternative = uploaded.some(
    (file) => file.text_value?.trim() && ['SLIP_NO', 'CONFIRMATION'].includes(file.kind),
  );
  return policy === 'NONE' || hasFile || (policy === 'PHOTO_OR_ALTERNATIVE' && alternative);
}
export async function assertEvidenceSatisfied(ctx: Context, use: Use) {
  const [project] = await ctx.db.select().from(projects).where(eq(projects.id, use.project_id));
  if (project.evidence_policy === 'NONE') return;
  const files = await ctx.db
    .select()
    .from(evidence)
    .where(
      and(
        eq(evidence.vehicle_use_id, use.id),
        isNull(evidence.deleted_at),
        isNull(evidence.replaced_by_id),
        eq(evidence.upload_status, 'UPLOADED'),
      ),
    );
  if (!evidenceSatisfiesPolicy(project.evidence_policy, files))
    throw new AppError('SUBMIT_BLOCKED', '필수 증빙을 업로드하거나 대체증빙을 입력하세요.', {
      evidence_policy: project.evidence_policy,
    });
}
async function revision(ctx: Context, use: Use) {
  const detail = await rawDetail(ctx, use);
  const { revisions: _revisions, ...snapshot } = detail;
  void _revisions;
  const [r] = await ctx.db
    .insert(useRevisions)
    .values({
      vehicle_use_id: use.id,
      revision_no: use.current_revision_no,
      snapshot,
      submitted_by: ctx.user.id,
    })
    .returning();
  return r;
}
async function invalidateReview(ctx: Context, before: Use, nextStatus: Use['review_status']) {
  await assertUnlocked(ctx, before.id);
  if (['APPROVED', 'SUBMITTED'].includes(before.review_status)) {
    await ctx.db
      .update(useRevisions)
      .set({ decision: 'SUPERSEDED', updated_at: new Date() })
      .where(
        and(
          eq(useRevisions.vehicle_use_id, before.id),
          eq(useRevisions.revision_no, before.current_revision_no),
        ),
      );
  }
  await ctx.db
    .update(chargeLines)
    .set({
      approved_amount: null,
      tax_amount: null,
      line_review_status: 'PENDING',
      version: sql`${chargeLines.version} + 1`,
      updated_at: new Date(),
    })
    .where(
      and(
        eq(chargeLines.vehicle_use_id, before.id),
        isNull(chargeLines.deleted_at),
        ne(chargeLines.charge_type, 'ADJUSTMENT'),
      ),
    );
  const autoSubmit = nextStatus === 'SUBMITTED';
  const [after] = await ctx.db
    .update(vehicleUses)
    .set({
      review_status: nextStatus,
      approved_revision_id: null,
      current_revision_no: before.current_revision_no + Number(autoSubmit),
      driver_confirmed_at: null,
      version: before.version + 1,
      updated_at: new Date(),
    })
    .where(eq(vehicleUses.id, before.id))
    .returning();
  return after;
}
export async function contentChanged(ctx: Context, before: Use) {
  const nextStatus = reviewAfterEdit(before.review_status, ctx.user.role === 'DRIVER');
  const after = await invalidateReview(ctx, before, nextStatus);
  if (nextStatus === 'SUBMITTED') {
    await assertFormFieldsSatisfied(ctx, after);
    await revision(ctx, after);
  }
  return after;
}
async function resolveHeader(ctx: Context, input: CreateUseInput, previous?: Use) {
  await assertProjectAccess(ctx, input.project_id);
  if (
    ctx.user.role === 'DRIVER' &&
    (input.driver_id !== ctx.user.driver_id ||
      (input.customer_counterparty_id &&
        input.customer_counterparty_id !== previous?.customer_counterparty_id))
  )
    notFound();
  const [driver] = await ctx.db.select().from(drivers).where(eq(drivers.id, input.driver_id));
  const [vehicle] = await ctx.db.select().from(vehicles).where(eq(vehicles.id, input.vehicle_id));
  const [project] = await ctx.db.select().from(projects).where(eq(projects.id, input.project_id));
  if (!driver || !vehicle || !project) notFound();
  if (
    (!driver.active && previous?.driver_id !== driver.id) ||
    (!vehicle.active && previous?.vehicle_id !== vehicle.id) ||
    (!project.active && previous?.project_id !== project.id)
  )
    invalid('사용 중인 기준정보를 선택하세요.');
  if (input.work_type_id) {
    const [w] = await ctx.db.select().from(workTypes).where(eq(workTypes.id, input.work_type_id));
    if (!w || (!w.active && previous?.work_type_id !== w.id)) invalid('공종을 확인하세요.');
  }
  const [affiliation] = await ctx.db
    .select()
    .from(driverAffiliations)
    .where(
      and(
        eq(driverAffiliations.driver_id, driver.id),
        lte(driverAffiliations.valid_from, input.use_date),
        or(isNull(driverAffiliations.valid_to), gte(driverAffiliations.valid_to, input.use_date)),
      ),
    )
    .orderBy(desc(driverAffiliations.valid_from), desc(driverAffiliations.id));
  const payeeId = input.payee_counterparty_id ?? affiliation?.counterparty_id;
  if (!payeeId) invalid('사용일에 유효한 기사 소속 또는 지급처를 지정하세요.');
  if (
    ctx.user.role === 'DRIVER' &&
    payeeId !== affiliation?.counterparty_id &&
    payeeId !== previous?.payee_counterparty_id
  )
    notFound();
  const [payee] = await ctx.db.select().from(counterparties).where(eq(counterparties.id, payeeId));
  const [customer] = input.customer_counterparty_id
    ? await ctx.db.select().from(counterparties).where(eq(counterparties.id, input.customer_counterparty_id))
    : [];
  if (!payee || payee.kind === 'CUSTOMER' || (!payee.active && previous?.payee_counterparty_id !== payee.id))
    invalid('지급처를 확인하세요.');
  if (
    input.customer_counterparty_id &&
    (!customer ||
      customer.kind !== 'CUSTOMER' ||
      (!customer.active && previous?.customer_counterparty_id !== customer.id))
  )
    invalid('고객을 확인하세요.');
  const reviewer = input.reviewer_user_id
    ? await validateReviewer(ctx, project.id, input.reviewer_user_id)
    : null;
  const snapshot = {
    reviewer_name: reviewer?.name ?? null,
    reviewer_role: reviewer?.role ?? null,
    load_tonnage: input.load_tonnage ?? null,
    driver_name: driver.name,
    driver_phone: driver.phone,
    plate_no: vehicle.plate_no,
    vehicle_type: vehicle.vehicle_type,
    tonnage: vehicle.tonnage,
    payee_name: payee.name,
    payee_biz_no: payee.biz_no,
    project_name: project.name,
    customer_name: customer?.name ?? null,
  };
  return {
    reviewer_user_id: input.reviewer_user_id ?? null,
    load_tonnage: input.load_tonnage ?? null,
    use_date: input.use_date,
    end_date: input.end_date ?? null,
    project_id: project.id,
    work_type_id: input.work_type_id ?? null,
    requester: input.requester ?? null,
    driver_id: driver.id,
    vehicle_id: vehicle.id,
    payee_counterparty_id: payee.id,
    customer_counterparty_id: (customer?.id ?? null) as string | null,
    cargo_desc: input.cargo_desc ?? null,
    notes: input.notes ?? null,
    snapshot,
    operation_status: input.operation_status ?? previous?.operation_status ?? ('COMPLETED' as const),
  };
}
async function saveTrips(ctx: Context, use: Use, inputs: z.output<typeof createUseSchema>['trips']) {
  if (inputs === undefined) return;
  if (
    new Set(inputs.map((t) => t.seq)).size !== inputs.length ||
    new Set(inputs.filter((t) => t.client_row_id).map((t) => t.client_row_id)).size !==
      inputs.filter((t) => t.client_row_id).length
  )
    invalid('회차 또는 클라이언트 행 식별자가 중복되었습니다.');
  const old = await ctx.db.select().from(trips).where(eq(trips.vehicle_use_id, use.id));
  // Temporary negative seq allows a safe swap of existing row order under the parent lock.
  await ctx.db
    .update(trips)
    .set({ seq: sql`-${trips.seq}` })
    .where(eq(trips.vehicle_use_id, use.id));
  const kept: string[] = [];
  for (const input of inputs) {
    const existing = input.id
      ? old.find((t) => t.id === input.id)
      : input.client_row_id
        ? old.find((t) => t.client_row_id === input.client_row_id)
        : undefined;
    if (input.id && !existing) notFound();
    if (existing && kept.includes(existing.id)) invalid('같은 운행이 중복 지정되었습니다.');
    const { id: _id, ...rest } = input;
    void _id;
    const values = {
      ...rest,
      depart_at: input.depart_at ? new Date(input.depart_at) : null,
      arrive_at: input.arrive_at ? new Date(input.arrive_at) : null,
      vehicle_use_id: use.id,
      updated_at: new Date(),
    };
    if (values.arrive_at && values.depart_at && values.arrive_at < values.depart_at)
      invalid('도착시각은 출발시각 이후여야 합니다.');
    const [row] = existing
      ? await ctx.db.update(trips).set(values).where(eq(trips.id, existing.id)).returning()
      : await ctx.db.insert(trips).values(values).returning();
    kept.push(row.id);
  }
  const removed = old.filter((t) => !kept.includes(t.id)).map((t) => t.id);
  if (removed.length) {
    await ctx.db
      .update(evidence)
      .set({ trip_id: null, updated_at: new Date() })
      .where(inArray(evidence.trip_id, removed));
    await ctx.db
      .update(chargeLines)
      .set({ trip_id: null, updated_at: new Date() })
      .where(inArray(chargeLines.trip_id, removed));
    await ctx.db.delete(trips).where(inArray(trips.id, removed));
  }
}
async function saveCharges(
  ctx: Context,
  use: Use,
  inputs: ChargeInput[],
  reprice = false,
  internalDirection?: 'RECEIVABLE',
) {
  const old = await ctx.db
    .select()
    .from(chargeLines)
    .where(and(eq(chargeLines.vehicle_use_id, use.id), isNull(chargeLines.deleted_at)));
  const kept: string[] = [];
  for (const input of inputs) {
    if (input.direction === 'RECEIVABLE' && !canSeeReceivable(ctx) && internalDirection !== 'RECEIVABLE')
      notFound();
    if (internalDirection && input.direction !== internalDirection)
      invalid('자동 계산 비용의 방향이 다릅니다.');
    const existing = input.id ? old.find((c) => c.id === input.id) : undefined;
    if (input.id && !existing) notFound();
    if (existing && kept.includes(existing.id)) invalid('같은 비용이 중복 지정되었습니다.');
    if (existing && (existing.direction !== input.direction || existing.charge_type !== input.charge_type))
      invalid('기존 비용의 방향과 종류는 변경할 수 없습니다.');
    const counterpartyId =
      input.direction === 'PAYABLE' ? use.payee_counterparty_id : use.customer_counterparty_id;
    if (!counterpartyId) invalid('고객 거래처를 먼저 지정하세요.');
    if (input.trip_id) {
      const [trip] = await ctx.db
        .select()
        .from(trips)
        .where(and(eq(trips.id, input.trip_id), eq(trips.vehicle_use_id, use.id)));
      if (!trip) notFound();
    }
    const base = input.charge_type === 'BASE';
    const preserve =
      existing &&
      (existing.rate_agreement_id !== null ||
        existing.unit_price !== null ||
        existing.agreement_snapshot !== null) &&
      !reprice &&
      (!input.billing_unit || existing.billing_unit === input.billing_unit);
    const rate =
      base && !preserve
        ? await findRate(ctx.db, {
            project_id: use.project_id,
            counterparty_id: counterpartyId,
            vehicle_id: use.vehicle_id,
            use_date: use.use_date,
            direction: input.direction,
            billing_unit: input.billing_unit,
          })
        : null;
    const agreementChanged = !!existing && !preserve && existing.rate_agreement_id !== (rate?.id ?? null);
    const unit =
      (preserve ? existing.billing_unit : rate?.billing_unit) ??
      input.billing_unit ??
      existing?.billing_unit ??
      'PER_DAY';
    // Omission preserves a quantity only while the same agreement still applies.
    const previousQuantity = agreementChanged ? null : existing?.quantity;
    const q = ['PER_DAY', 'HALF_DAY', 'MONTHLY', 'LUMP_SUM'].includes(unit)
      ? (input.quantity ?? previousQuantity ?? '1')
      : input.quantity !== undefined
        ? input.quantity
        : (previousQuantity ?? null);
    const price = preserve ? existing.unit_price : (rate?.unit_price ?? null);
    const snapshot = preserve
      ? existing.agreement_snapshot
      : rate
        ? {
            id: rate.id,
            name: rate.name,
            billing_unit: rate.billing_unit,
            unit_price: rate.unit_price,
            tax_mode: rate.tax_mode,
            rounding: rate.rounding,
            min_charge: rate.min_charge,
            valid_from: rate.valid_from,
            valid_to: rate.valid_to,
          }
        : null;
    const taxMode = preserve ? existing.tax_mode : (rate?.tax_mode ?? 'VAT_EXCLUDED');
    const rounding = preserve ? existing.rounding : (rate?.rounding ?? 'HALF_UP');
    const computed = input.included_in_base
      ? 0
      : base && price !== null && q !== null
        ? computeAmount(q, price, rounding, snapshot?.min_charge as number | null)
        : null;
    const values = {
      vehicle_use_id: use.id,
      trip_id: input.trip_id ?? null,
      direction: input.direction,
      counterparty_id: counterpartyId,
      charge_type: input.charge_type,
      billing_unit: unit,
      quantity: q,
      unit_price: base ? price : null,
      rate_agreement_id: preserve ? existing.rate_agreement_id : (rate?.id ?? null),
      rate_basis_date: use.use_date,
      agreement_snapshot:
        snapshot?.source === 'IMPORT' && typeof snapshot.contract_unit_price === 'number'
          ? {
              ...snapshot,
              contract_computed_amount:
                q === null
                  ? null
                  : computeAmount(
                      q,
                      snapshot.contract_unit_price,
                      rounding,
                      snapshot.contract_min_charge as number | null,
                    ),
            }
          : snapshot,
      tax_mode: taxMode,
      rounding,
      computed_amount: computed,
      requested_amount: input.requested_amount ?? null,
      approved_amount: null,
      tax_amount: null,
      price_status: (computed !== null || input.requested_amount != null
        ? 'CONFIRMED'
        : 'PENDING') as Charge['price_status'],
      line_review_status: 'PENDING' as const,
      reason: input.reason ?? null,
      included_in_base: input.included_in_base,
      updated_at: new Date(),
    };
    const [row] = existing
      ? await ctx.db
          .update(chargeLines)
          .set({ ...values, version: existing.version + 1 })
          .where(eq(chargeLines.id, existing.id))
          .returning()
      : await ctx.db.insert(chargeLines).values(values).returning();
    kept.push(row.id);
  }
  const removed = old
    .filter(
      (c) =>
        !kept.includes(c.id) &&
        c.charge_type !== 'ADJUSTMENT' &&
        (internalDirection
          ? c.direction === internalDirection
          : canSeeReceivable(ctx) || c.direction === 'PAYABLE'),
    )
    .map((c) => c.id);
  if (removed.length)
    await ctx.db
      .update(chargeLines)
      .set({ deleted_at: new Date(), updated_at: new Date(), version: sql`${chargeLines.version} + 1` })
      .where(inArray(chargeLines.id, removed));
}
export async function createUse(ctx: Context, raw: CreateUseInput) {
  const input = createUseSchema.parse(raw);
  // Zod reconstructs the nested objects in schema order and applies defaults.
  // Keep the original creation fingerprint independent of subsequent edits.
  const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return atomic(ctx, async (tx) => {
    if (input.client_request_id) {
      await tx.db.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`use:${input.client_request_id}`}, 0))`,
      );
      const [previous] = await tx.db
        .select()
        .from(vehicleUses)
        .where(eq(vehicleUses.client_request_id, input.client_request_id));
      if (previous) {
        await assertCanReadUse(tx, previous);
        if (previous.create_request_hash !== requestHash)
          throw new AppError(
            'IDEMPOTENCY_MISMATCH',
            '같은 생성 식별자에 다른 내용을 저장할 수 없습니다. 기존 운행을 열어 수정하세요.',
          );
        return getUse(tx, previous.id);
      }
    }
    if (input.operation_status === 'CANCELED') invalid('취소는 취소 API를 사용하세요.');
    const header = await resolveHeader(tx, input);
    if (header.end_date && header.end_date < header.use_date) invalid('종료일을 확인하세요.');
    const [use] = await tx.db
      .insert(vehicleUses)
      .values({
        ...header,
        client_request_id: input.client_request_id,
        create_request_hash: input.client_request_id ? requestHash : null,
        use_no: await nextUseNo(tx.db, input.use_date),
        created_by_user_id: tx.user.id,
        entered_as: tx.user.role === 'DRIVER' ? 'DRIVER_SELF' : 'PROXY',
      })
      .returning();
    await saveTrips(tx, use, input.trips);
    const lines = input.charge_lines ?? [
      {
        direction: 'PAYABLE' as const,
        charge_type: 'BASE' as const,
        billing_unit: input.billing_unit,
        quantity: input.quantity,
        included_in_base: false,
      },
      ...(use.customer_counterparty_id
        ? [
            {
              direction: 'RECEIVABLE' as const,
              charge_type: 'BASE' as const,
              billing_unit: input.billing_unit,
              quantity: input.quantity,
              included_in_base: false,
            },
          ]
        : []),
    ];
    await saveCharges(tx, use, lines);
    const after = await rawDetail(tx, use);
    await audit(tx, 'CREATE', 'vehicle_use', use.id, null, after);
    return publicDetail(tx, after);
  });
}
export async function updateUse(ctx: Context, id: string, raw: UpdateUseInput) {
  const input = updateUseSchema.parse(raw);
  return atomic(ctx, async (tx) => {
    const before = await rawUse(tx, id, true);
    await assertCanEditUse(tx, before);
    assertVersion(before, input.version);
    await assertUnlocked(tx, id);
    if (before.operation_status === 'CANCELED') invalid('취소된 사용 건은 수정할 수 없습니다.');
    if (input.operation_status === 'CANCELED') invalid('취소 API를 사용하세요.');
    const beforeDetail = await rawDetail(tx, before);
    // Driver edits retain the private customer link, but cannot set it.
    if (tx.user.role === 'DRIVER' && input.customer_counterparty_id !== undefined) notFound();
    const merged = {
      ...before,
      ...input,
      client_request_id: undefined,
      payee_counterparty_id:
        input.payee_counterparty_id ??
        ((input.driver_id && input.driver_id !== before.driver_id) ||
        (input.use_date && input.use_date !== before.use_date)
          ? undefined
          : before.payee_counterparty_id),
      customer_counterparty_id:
        tx.user.role === 'DRIVER'
          ? before.customer_counterparty_id
          : input.customer_counterparty_id === undefined
            ? before.customer_counterparty_id
            : input.customer_counterparty_id,
    };
    const header = await resolveHeader(tx, merged, before);
    if (header.end_date && header.end_date < header.use_date) invalid('종료일을 확인하세요.');
    const [use] = await tx.db.update(vehicleUses).set(header).where(eq(vehicleUses.id, id)).returning();
    await saveTrips(tx, use, input.trips);
    const reprice = [
      'project_id',
      'driver_id',
      'vehicle_id',
      'payee_counterparty_id',
      'customer_counterparty_id',
      'use_date',
    ].some((k) => before[k as keyof Use] !== use[k as keyof Use]);
    if (input.charge_lines) await saveCharges(tx, use, input.charge_lines, reprice);
    else if (reprice || input.quantity !== undefined || input.billing_unit !== undefined) {
      const lines = beforeDetail.charge_lines
        .filter((c) => canSeeReceivable(tx) || c.direction === 'PAYABLE')
        .filter((c) => c.charge_type !== 'ADJUSTMENT')
        .map((c) => ({
          id: c.id,
          direction: c.direction,
          charge_type: c.charge_type as ChargeInput['charge_type'],
          billing_unit: c.charge_type === 'BASE' ? input.billing_unit : c.billing_unit,
          quantity: c.charge_type === 'BASE' ? input.quantity : c.quantity,
          requested_amount: c.requested_amount,
          reason: c.reason,
          included_in_base: c.included_in_base,
          trip_id: c.trip_id,
        }));
      await saveCharges(tx, use, lines, reprice);
    }
    // Header changes also refresh private customer rates using server-owned inputs.
    if (reprice && tx.user.role === 'DRIVER') {
      const hidden = beforeDetail.charge_lines
        .filter((c) => c.direction === 'RECEIVABLE' && c.charge_type !== 'ADJUSTMENT')
        .map((c) => ({
          id: c.id,
          direction: c.direction,
          charge_type: c.charge_type as ChargeInput['charge_type'],
          billing_unit: c.charge_type === 'BASE' ? undefined : c.billing_unit,
          quantity: c.charge_type === 'BASE' ? undefined : c.quantity,
          requested_amount: c.requested_amount,
          reason: c.reason,
          included_in_base: c.included_in_base,
          trip_id: c.trip_id,
        }));
      await saveCharges(tx, use, hidden, true, 'RECEIVABLE');
    }
    const afterUse = await contentChanged(tx, before);
    const after = await rawDetail(tx, afterUse);
    await audit(tx, 'UPDATE', 'vehicle_use', id, beforeDetail, after, input.change_reason);
    return publicDetail(tx, after);
  });
}
async function assertFormFieldsSatisfied(ctx: Context, use: Use, lines?: Charge[]) {
  if (use.reviewer_user_id) await validateReviewer(ctx, use.project_id, use.reviewer_user_id);
  const tripRows = await ctx.db.select().from(trips).where(eq(trips.vehicle_use_id, use.id));
  const chargeRows =
    lines ??
    (await ctx.db
      .select()
      .from(chargeLines)
      .where(and(eq(chargeLines.vehicle_use_id, use.id), isNull(chargeLines.deleted_at))));
  const settings = await getEffectiveFormSettings(ctx, use.project_id);
  const fields = requiredFieldErrors(
    {
      ...use,
      trips: tripRows,
      charge_lines: chargeRows.filter((line) => ctx.user.role !== 'DRIVER' || line.direction === 'PAYABLE'),
    },
    settings.modes,
  );
  if (fields.length)
    throw new AppError('SUBMIT_BLOCKED', fields.map((field) => field.reason).join(' '), { fields });
}
export function missingChargeQuantity(line: Charge) {
  return (
    line.charge_type === 'BASE' &&
    ['PER_TRIP', 'PER_HOUR', 'PER_TON', 'PER_M3'].includes(line.billing_unit) &&
    line.quantity === null
  );
}
export function chargeQuantityMessage(line: Charge) {
  return line.direction === 'RECEIVABLE' ? '고객 청구 수량을 입력하세요' : '청구 수량을 입력하세요';
}
export async function submitUse(ctx: Context, id: string, raw: z.input<typeof versionInput>) {
  const input = versionInput.strict().parse(raw);
  return atomic(ctx, async (tx) => {
    const before = await rawUse(tx, id, true);
    assertVersion(before, input.version);
    await assertUnlocked(tx, id);
    assertTransition(before.review_status, 'submit');
    if (before.operation_status === 'CANCELED') invalid('취소된 사용 건은 제출할 수 없습니다.');
    await assertEvidenceSatisfied(tx, before);
    const lines = await tx.db
      .select()
      .from(chargeLines)
      .where(and(eq(chargeLines.vehicle_use_id, id), isNull(chargeLines.deleted_at)));
    await assertFormFieldsSatisfied(tx, before, lines);
    const missing = lines.filter(
      (line) => (canSeeReceivable(tx) || line.direction === 'PAYABLE') && missingChargeQuantity(line),
    );
    if (missing.length)
      throw new AppError('SUBMIT_BLOCKED', '청구 수량을 입력하세요', {
        fields: missing.map((line) => ({
          target: `charge:${line.id}.quantity`,
          reason: chargeQuantityMessage(line),
        })),
      });
    const [use] = await tx.db
      .update(vehicleUses)
      .set({
        review_status: 'SUBMITTED',
        current_revision_no: before.current_revision_no + 1,
        version: before.version + 1,
        updated_at: new Date(),
      })
      .where(eq(vehicleUses.id, id))
      .returning();
    await revision(tx, use);
    await audit(tx, 'SUBMIT', 'vehicle_use', id, before, use);
    return getUse(tx, id);
  });
}
async function applyDecision(ctx: Context, line: Charge, decision?: z.output<typeof lineDecision>) {
  const status = decision?.line_review_status ?? 'APPROVED';
  let supply: number | null = null;
  let tax: number | null = null;
  if (status === 'APPROVED') {
    if (missingChargeQuantity(line))
      invalid(chargeQuantityMessage(line), { charge_line_id: line.id, target: `charge:${line.id}.quantity` });
    if (line.price_status === 'PENDING' && decision?.approved_amount === undefined)
      invalid('단가 미확정 비용의 승인액을 지정하세요.', { charge_line_id: line.id });
    const amount = proposedAmount(line);
    // Adjustments store a supply difference; other VAT_INCLUDED costs store gross.
    const calculated =
      amount === null
        ? null
        : line.charge_type === 'ADJUSTMENT'
          ? { supply: amount, tax: taxFromSupply(amount, line.tax_mode) }
          : calculateTax(amount, line.tax_mode);
    if (decision?.approved_amount !== undefined) {
      supply = decision.approved_amount;
      // Sending the same supply again must preserve the VAT-inclusive remainder.
      // A genuinely changed approval is a new supply amount, with tax on that supply.
      tax =
        line.approved_amount === supply && line.tax_amount !== null
          ? line.tax_amount
          : calculated?.supply === supply
            ? calculated.tax
            : taxFromSupply(supply, line.tax_mode);
    } else if (line.approved_amount !== null && line.tax_amount !== null) {
      supply = line.approved_amount;
      tax = line.tax_amount;
    } else {
      if (!calculated) invalid('승인할 금액이 없습니다.');
      supply = calculated.supply;
      tax = calculated.tax;
    }
    if (line.included_in_base && supply !== 0) invalid('기본운임 포함 항목의 승인액은 0원이어야 합니다.');
  }
  const [after] = await ctx.db
    .update(chargeLines)
    .set({
      approved_amount: supply,
      tax_amount: tax,
      price_status: status === 'APPROVED' ? 'CONFIRMED' : line.price_status,
      line_review_status: status,
      version: line.version + 1,
      updated_at: new Date(),
    })
    .where(eq(chargeLines.id, line.id))
    .returning();
  await audit(ctx, 'REVIEW_LINE', 'charge_line', line.id, line, after, decision?.reason);
  return after;
}
export async function approveUse(ctx: Context, id: string, raw: z.input<typeof approveSchema>) {
  const input = approveSchema.parse(raw);
  return atomic(ctx, async (tx) => {
    const before = await rawUse(tx, id, true);
    await assertCanReview(tx, before);
    assertVersion(before, input.version);
    await assertUnlocked(tx, id);
    assertTransition(before.review_status, 'approve');
    await assertEvidenceSatisfied(tx, before);
    const lines = await tx.db
      .select()
      .from(chargeLines)
      .where(and(eq(chargeLines.vehicle_use_id, id), isNull(chargeLines.deleted_at)))
      .for('update');
    if (
      input.lines &&
      (new Set(input.lines.map((l) => l.id)).size !== input.lines.length ||
        input.lines.some((l) => !lines.some((c) => c.id === l.id)))
    )
      invalid('검수 대상 비용을 확인하세요.');
    for (const line of lines) {
      const decision = input.lines?.find((l) => l.id === line.id);
      if (!decision && line.line_review_status === 'APPROVED' && missingChargeQuantity(line))
        invalid(chargeQuantityMessage(line), {
          charge_line_id: line.id,
          target: `charge:${line.id}.quantity`,
        });
      if (decision || line.line_review_status === 'PENDING') await applyDecision(tx, line, decision);
    }
    const [r] = await tx.db
      .update(useRevisions)
      .set({
        decision: 'APPROVED',
        decided_by: tx.user.id,
        decided_at: new Date(),
        comment: input.comment,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(useRevisions.vehicle_use_id, id),
          eq(useRevisions.revision_no, before.current_revision_no),
          eq(useRevisions.decision, 'PENDING'),
        ),
      )
      .returning();
    if (!r) invalid('제출 버전을 확인하세요.');
    const [after] = await tx.db
      .update(vehicleUses)
      .set({
        review_status: 'APPROVED',
        approved_revision_id: r.id,
        version: before.version + 1,
        updated_at: new Date(),
      })
      .where(eq(vehicleUses.id, id))
      .returning();
    await audit(tx, 'APPROVE', 'vehicle_use', id, before, after, input.comment);
    return getUse(tx, id);
  });
}
export async function requestFix(ctx: Context, id: string, raw: z.input<typeof fixSchema>) {
  const input = fixSchema.parse(raw);
  return atomic(ctx, async (tx) => {
    const before = await rawUse(tx, id, true);
    await assertCanReview(tx, before);
    assertVersion(before, input.version);
    await assertUnlocked(tx, id);
    assertTransition(before.review_status, 'request-fix');
    // Serialize with settings changes so every request uses the current driver policy.
    await tx.db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('w9:form-settings', 0))`);
    const settings = await getEffectiveFormSettings(tx, before.project_id);
    const charges = await tx.db
      .select()
      .from(chargeLines)
      .where(and(eq(chargeLines.vehicle_use_id, id), isNull(chargeLines.deleted_at)));
    const fields = input.fix_items.flatMap(({ target }) => {
      const reason = fixTargetBlockedReason(target, settings.driver_modes!, charges);
      return reason ? [{ target, reason }] : [];
    });
    if (fields.length) invalid(fields.map((field) => field.reason).join(' '), { fields });
    await tx.db
      .update(useRevisions)
      .set({
        decision: 'NEEDS_FIX',
        decided_by: tx.user.id,
        decided_at: new Date(),
        comment: input.comment,
        fix_items: input.fix_items,
        updated_at: new Date(),
      })
      .where(
        and(eq(useRevisions.vehicle_use_id, id), eq(useRevisions.revision_no, before.current_revision_no)),
      );
    const [after] = await tx.db
      .update(vehicleUses)
      .set({ review_status: 'NEEDS_FIX', version: before.version + 1, updated_at: new Date() })
      .where(eq(vehicleUses.id, id))
      .returning();
    await audit(tx, 'REQUEST_FIX', 'vehicle_use', id, before, after, input.comment);
    return getUse(tx, id);
  });
}
export async function reviewChargeLine(ctx: Context, id: string, raw: unknown) {
  const input = lineDecision
    .omit({ id: true })
    .extend({ version: z.number().int().positive() })
    .strict()
    .parse(raw);
  return atomic(ctx, async (tx) => {
    const [line] = await tx.db
      .select()
      .from(chargeLines)
      .where(and(eq(chargeLines.id, id), isNull(chargeLines.deleted_at)));
    if (!line) notFound();
    const use = await rawUse(tx, line.vehicle_use_id, true);
    await assertCanReview(tx, use);
    assertVersion(use, input.version);
    await assertUnlocked(tx, use.id);
    if (use.review_status !== 'SUBMITTED')
      invalid('제출된 사용 건만 라인 검수가 가능합니다. 승인 후 변경은 사용 건 수정으로 재제출하세요.');
    const after = await applyDecision(tx, line, { ...input, id });
    await tx.db
      .update(vehicleUses)
      .set({ version: use.version + 1, updated_at: new Date() })
      .where(eq(vehicleUses.id, use.id));
    return { ...after, use_version: use.version + 1 };
  });
}
export async function confirmByDriver(ctx: Context, id: string, raw: z.input<typeof versionInput>) {
  const input = versionInput.strict().parse(raw);
  return atomic(ctx, async (tx) => {
    const before = await rawUse(tx, id, true);
    assertVersion(before, input.version);
    if (tx.user.role !== 'DRIVER' || tx.user.driver_id !== before.driver_id) notFound();
    if (before.entered_as !== 'PROXY') invalid('대리 입력 건만 기사 확인이 필요합니다.');
    const [after] = await tx.db
      .update(vehicleUses)
      .set({ driver_confirmed_at: new Date(), version: before.version + 1, updated_at: new Date() })
      .where(eq(vehicleUses.id, id))
      .returning();
    await audit(tx, 'DRIVER_CONFIRM', 'vehicle_use', id, before, after);
    return getUse(tx, id);
  });
}
export async function cancelUse(ctx: Context, id: string, raw: z.input<typeof reasonSchema>) {
  const input = reasonSchema.parse(raw);
  return atomic(ctx, async (tx) => {
    const before = await rawUse(tx, id, true);
    assertVersion(before, input.version);
    await assertUnlocked(tx, id);
    if (before.operation_status === 'CANCELED') invalid('이미 취소된 사용 건입니다.');
    await tx.db.update(vehicleUses).set({ operation_status: 'CANCELED' }).where(eq(vehicleUses.id, id));
    await invalidateReview(tx, before, 'DRAFT');
    await tx.db
      .update(useRevisions)
      .set({ decision: 'SUPERSEDED', updated_at: new Date() })
      .where(and(eq(useRevisions.vehicle_use_id, id), eq(useRevisions.decision, 'PENDING')));
    const after = await rawUse(tx, id);
    await audit(tx, 'CANCEL', 'vehicle_use', id, before, after, input.reason);
    return getUse(tx, id);
  });
}
export async function copyUse(ctx: Context, id: string, raw: z.input<typeof copySchema>) {
  const input = copySchema.parse(raw);
  return atomic(ctx, async (tx) => {
    const source = await getUse(tx, id);
    const created = await createUse(tx, {
      client_request_id: input.client_request_id,
      use_date: input.use_date ?? todaySeoul(),
      reviewer_user_id: source.reviewer_user_id,
      load_tonnage: source.load_tonnage,
      project_id: source.project_id,
      work_type_id: source.work_type_id,
      requester: source.requester,
      driver_id: source.driver_id,
      vehicle_id: source.vehicle_id,
      customer_counterparty_id: canSeeReceivable(tx) ? source.customer_counterparty_id : undefined,
      cargo_desc: source.cargo_desc,
      notes: source.notes,
      trips: source.trips.map((t) => ({
        seq: t.seq,
        status: 'PLANNED',
        origin: t.origin,
        destination: t.destination,
        via: t.via,
        cargo_desc: t.cargo_desc,
        quantity: t.quantity,
        quantity_unit: t.quantity_unit,
        hours: t.hours,
        is_empty_return: t.is_empty_return,
        notes: t.notes,
      })),
      operation_status: 'PLANNED',
      charge_lines: source.charge_lines
        .filter((c) => c.charge_type !== 'ADJUSTMENT')
        .map((c) => ({
          direction: c.direction,
          charge_type: c.charge_type as ChargeInput['charge_type'],
          billing_unit: c.billing_unit,
          quantity: c.quantity,
          requested_amount: c.requested_amount,
          reason: c.reason,
          included_in_base: c.included_in_base,
        })),
    });
    await audit(tx, 'COPY', 'vehicle_use', created.id, { source_id: id }, { id: created.id });
    return created;
  });
}
export async function listUses(ctx: Context, raw: unknown = {}) {
  const q = listUsesSchema.parse(raw);
  const scope = await accessibleUseFilter(ctx);
  const filter = and(
    scope,
    q.project_id ? eq(vehicleUses.project_id, q.project_id) : undefined,
    q.driver_id ? eq(vehicleUses.driver_id, q.driver_id) : undefined,
    q.from ? gte(vehicleUses.use_date, q.from) : undefined,
    q.to ? lte(vehicleUses.use_date, q.to) : undefined,
    q.review_status ? eq(vehicleUses.review_status, q.review_status) : undefined,
    q.operation_status ? eq(vehicleUses.operation_status, q.operation_status) : undefined,
    q.search
      ? or(ilike(vehicleUses.use_no, `%${q.search}%`), ilike(vehicleUses.cargo_desc, `%${q.search}%`))
      : undefined,
  );
  const order = q.order === 'asc' ? asc : desc;
  const rows = await ctx.db
    .select()
    .from(vehicleUses)
    .where(filter)
    .orderBy(
      order(vehicleUses[q.sort]),
      asc(vehicleUses.created_at),
      asc(sql`split_part(${vehicleUses.use_no}, '-', 3)::bigint`),
      asc(vehicleUses.id),
    )
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const baseAmounts = rows.length
    ? await ctx.db
        .select({
          use_id: chargeLines.vehicle_use_id,
          amount: sql<number | null>`${proposedAmountSql}`,
          approved: chargeLines.approved_amount,
          status: chargeLines.line_review_status,
        })
        .from(chargeLines)
        .where(
          and(
            inArray(
              chargeLines.vehicle_use_id,
              rows.map((r) => r.id),
            ),
            eq(chargeLines.direction, 'PAYABLE'),
            eq(chargeLines.charge_type, 'BASE'),
            isNull(chargeLines.deleted_at),
            ne(chargeLines.line_review_status, 'REJECTED'),
          ),
        )
    : [];
  const ids = rows.map((r) => r.id);
  const tripRows = ids.length
    ? await ctx.db
        .select({ use_id: trips.vehicle_use_id, origin: trips.origin, destination: trips.destination })
        .from(trips)
        .where(inArray(trips.vehicle_use_id, ids))
        .orderBy(asc(trips.vehicle_use_id), asc(trips.seq))
    : [];
  const fixIds = rows.filter((r) => r.review_status === 'NEEDS_FIX').map((r) => r.id);
  const fixRows = fixIds.length
    ? await ctx.db
        .select({
          use_id: useRevisions.vehicle_use_id,
          fix_items: useRevisions.fix_items,
          comment: useRevisions.comment,
        })
        .from(useRevisions)
        .where(and(inArray(useRevisions.vehicle_use_id, fixIds), eq(useRevisions.decision, 'NEEDS_FIX')))
        .orderBy(desc(useRevisions.revision_no))
    : [];
  const displayRows = rows.map(({ create_request_hash: _hash, ...row }) => {
    void _hash;
    const routeTrips = tripRows.filter((trip) => trip.use_id === row.id);
    const fix = fixRows.find((item) => item.use_id === row.id);
    const fixItems = (fix?.fix_items ?? []) as { message?: string }[];
    const lines = baseAmounts.filter((line) => line.use_id === row.id);
    const amounts = lines.map((line) => line.approved ?? line.amount);
    return {
      ...row,
      payable_base_amount:
        !amounts.length || amounts.some((amount) => amount === null) ? null : sumMoney(amounts),
      payable_base_approved: lines.length > 0 && lines.every((line) => line.status === 'APPROVED'),
      route_summary: routeSummary(routeTrips),
      fix_message: fix ? (fixItems[0]?.message ?? fix.comment ?? null) : null,
    };
  });
  const [{ total }] = await ctx.db
    .select({ total: sql<number>`count(*)::int` })
    .from(vehicleUses)
    .where(filter);
  const amounts = await ctx.db
    .select({
      use_id: chargeLines.vehicle_use_id,
      amount: chargeLines.approved_amount,
      direction: chargeLines.direction,
    })
    .from(chargeLines)
    .innerJoin(vehicleUses, eq(vehicleUses.id, chargeLines.vehicle_use_id))
    .where(
      and(
        filter,
        isNull(chargeLines.deleted_at),
        eq(chargeLines.line_review_status, 'APPROVED'),
        canSeeReceivable(ctx) ? undefined : eq(chargeLines.direction, 'PAYABLE'),
      ),
    );
  const sum = (direction?: 'PAYABLE' | 'RECEIVABLE', page = false) =>
    sumMoney(
      amounts
        .filter(
          (a) => (!direction || a.direction === direction) && (!page || rows.some((r) => r.id === a.use_id)),
        )
        .map((a) => a.amount),
    );
  return redactForDriver(ctx, {
    rows: displayRows,
    page: q.page,
    pageSize: q.pageSize,
    total,
    totals: {
      pageSum: sum('PAYABLE', true),
      filteredSum: sum('PAYABLE'),
      ...(canSeeReceivable(ctx)
        ? { receivablePageSum: sum('RECEIVABLE', true), receivableFilteredSum: sum('RECEIVABLE') }
        : {}),
    },
  });
}
