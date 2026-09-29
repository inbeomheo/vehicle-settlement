import { and, eq, isNull, lte, gte, or, inArray, sql, type SQL } from 'drizzle-orm';
import { projectAssignments, users, vehicleUses, evidence } from './db/schema';
import type { Context } from './context';
import { todaySeoul } from './context';
import { AppError, notFound } from './errors';
export async function assertActive(ctx: Context) {
  const [user] = await ctx.db.select().from(users).where(eq(users.id, ctx.user.id));
  if (!user || user.status !== 'ACTIVE') throw new AppError('UNAUTHENTICATED', '다시 로그인해 주세요.');
  ctx.user = user;
}
export function canSeeReceivable(ctx: Context) {
  return ctx.user.role !== 'DRIVER';
}
export function assertAdmin(ctx: Context) {
  if (ctx.user.role !== 'ADMIN') throw new AppError('FORBIDDEN', '관리자 권한이 필요합니다.');
}
export async function accessibleProjectIds(ctx: Context): Promise<string[] | null> {
  await assertActive(ctx);
  if (ctx.user.role === 'ADMIN' || (ctx.user.role === 'SETTLEMENT_MANAGER' && ctx.user.all_projects))
    return null;
  const today = todaySeoul();
  const rows = await ctx.db
    .select({ id: projectAssignments.project_id })
    .from(projectAssignments)
    .where(
      and(
        eq(projectAssignments.user_id, ctx.user.id),
        isNull(projectAssignments.revoked_at),
        lte(projectAssignments.valid_from, today),
        or(isNull(projectAssignments.valid_to), gte(projectAssignments.valid_to, today)),
      ),
    );
  return [...new Set(rows.map((r) => r.id))];
}
export async function assertProjectAccess(ctx: Context, projectId: string) {
  const ids = await accessibleProjectIds(ctx);
  if (ids && !ids.includes(projectId)) notFound();
}
export async function accessibleUseFilter(ctx: Context): Promise<SQL | undefined> {
  const ids = await accessibleProjectIds(ctx);
  return and(
    ids === null ? undefined : ids.length ? inArray(vehicleUses.project_id, ids) : sql`false`,
    ctx.user.role === 'DRIVER' ? eq(vehicleUses.driver_id, ctx.user.driver_id!) : undefined,
  );
}
export async function assertCanReadUse(
  ctx: Context,
  use: Pick<typeof vehicleUses.$inferSelect, 'project_id' | 'driver_id'>,
) {
  await assertProjectAccess(ctx, use.project_id);
  if (ctx.user.role === 'DRIVER' && use.driver_id !== ctx.user.driver_id) notFound();
}
export const assertCanEditUse = assertCanReadUse;
export async function assertCanReview(
  ctx: Context,
  use: Pick<typeof vehicleUses.$inferSelect, 'project_id' | 'driver_id'>,
) {
  await assertCanReadUse(ctx, use);
  if (ctx.user.role === 'DRIVER') throw new AppError('FORBIDDEN', '담당자만 검수할 수 있습니다.');
}
export async function assertCanSettle(ctx: Context, projectId?: string) {
  await assertActive(ctx);
  if (!['ADMIN', 'SETTLEMENT_MANAGER'].includes(ctx.user.role))
    throw new AppError('FORBIDDEN', '정산 담당자 권한이 필요합니다.');
  if (projectId) await assertProjectAccess(ctx, projectId);
}
// A retained attachment may belong to a previous driver even in the current
// revision. Preserve it for managers but do not transfer historical access.
export function driverEvidenceFilter(ctx: Context): SQL | undefined {
  if (ctx.user.role !== 'DRIVER') return undefined;
  return sql`NOT EXISTS (
    SELECT 1 FROM users uploader WHERE uploader.id=${evidence.uploaded_by}
      AND uploader.driver_id IS NOT NULL AND uploader.driver_id IS DISTINCT FROM ${ctx.user.driver_id}::uuid
  ) AND NOT EXISTS (
    SELECT 1 FROM use_revisions revision WHERE revision.vehicle_use_id=${evidence.vehicle_use_id}
      AND revision.snapshot->>'driver_id' IS DISTINCT FROM ${ctx.user.driver_id}
      AND revision.snapshot->'evidence' @> jsonb_build_array(jsonb_build_object('id', ${evidence.id}::text))
  )`;
}
export async function assertDriverEvidenceAccess(ctx: Context, id: string) {
  if (ctx.user.role !== 'DRIVER') return;
  const [visible] = await ctx.db
    .select({ id: evidence.id })
    .from(evidence)
    .where(and(eq(evidence.id, id), driverEvidenceFilter(ctx)));
  if (!visible) notFound();
}
// Apply to complete nested responses, revision snapshots and audit payloads before exposing them to a driver.
export function redactForDriver<T>(
  ctx: Context,
  value: T,
  hiddenEvidenceIds: ReadonlySet<string> = new Set(),
): T {
  if (canSeeReceivable(ctx)) return value;
  const hidden = new Set(hiddenEvidenceIds);
  const collect = (v: unknown): void => {
    if (!v || typeof v !== 'object') return;
    if ('revision_no' in v && 'snapshot' in v) {
      const snapshot = v.snapshot as Record<string, unknown> | null;
      if (snapshot?.driver_id !== ctx.user.driver_id && Array.isArray(snapshot?.evidence)) {
        for (const file of snapshot.evidence) if (file?.id) hidden.add(file.id);
      }
    }
    for (const item of Object.values(v)) collect(item);
  };
  collect(value);
  const visit = (v: unknown): unknown => {
    if (v instanceof Date || v === null || typeof v !== 'object') return v;
    if (Array.isArray(v))
      return v
        .filter((x) => {
          if (!x || typeof x !== 'object') return true;
          if ('direction' in x && x.direction === 'RECEIVABLE') return false;
          if ('revision_no' in x && 'snapshot' in x) return x.snapshot?.driver_id === ctx.user.driver_id;
          if ('client_upload_id' in x && hidden.has(x.id)) return false;
          return true;
        })
        .map(visit);
    return Object.fromEntries(
      Object.entries(v)
        .filter(
          ([k]) =>
            ![
              'phone',
              'driver_phone',
              'contact_name',
              'bank_account',
              'customer_counterparty_id',
              'customer_name',
              'customer',
              'password_hash',
              'token_hash',
            ].includes(k),
        )
        .map(([k, val]) => [k, visit(val)]),
    );
  };
  return visit(value) as T;
}
