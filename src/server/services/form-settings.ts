import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  defaultFieldModes,
  fieldKeys,
  fieldModes,
  fieldKeyForFixTarget,
  type AdminFieldSettings,
  type EffectiveFieldSettings,
} from '../../shared/form-settings';
import { audit } from '../audit';
import { assertActive, assertAdmin, assertProjectAccess } from '../authz';
import type { Context } from '../context';
import { chargeLines, formFieldSettings, projects, useRevisions, vehicleUses } from '../db/schema';
import { AppError, notFound } from '../errors';
import { uuid } from './schemas';

export const formSettingsQuery = z.object({ project_id: uuid.optional() }).strict();
export const saveFormSettingsSchema = z
  .object({
    project_id: uuid.nullable(),
    fields: z
      .array(
        z
          .object({
            field_key: z.enum(fieldKeys),
            driver_mode: z.enum(fieldModes).nullable(),
            manager_mode: z.enum(fieldModes).nullable(),
            version: z.number().int().min(0),
          })
          .strict(),
      )
      .min(1)
      .max(fieldKeys.length)
      .refine(
        (rows) => new Set(rows.map((row) => row.field_key)).size === rows.length,
        '같은 항목을 두 번 지정할 수 없습니다.',
      ),
  })
  .strict();

async function checkProject(ctx: Context, projectId: string) {
  await assertProjectAccess(ctx, projectId);
  const [project] = await ctx.db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));
  if (!project) notFound();
}
async function resolve(
  ctx: Context,
  projectId: string | null,
): Promise<Omit<AdminFieldSettings, 'pending_fixes'>> {
  const rows = await ctx.db
    .select()
    .from(formFieldSettings)
    .where(
      or(
        isNull(formFieldSettings.project_id),
        projectId ? eq(formFieldSettings.project_id, projectId) : undefined,
      ),
    );
  const company = { driver: defaultFieldModes('driver'), manager: defaultFieldModes('manager') };
  for (const row of rows.filter((row) => row.project_id === null)) {
    if (row.driver_mode) company.driver[row.field_key] = row.driver_mode;
    if (row.manager_mode) company.manager[row.field_key] = row.manager_mode;
  }
  const effective = { driver: { ...company.driver }, manager: { ...company.manager } };
  const scoped = rows.filter((row) => row.project_id === projectId);
  if (projectId)
    for (const row of scoped) {
      if (row.driver_mode) effective.driver[row.field_key] = row.driver_mode;
      if (row.manager_mode) effective.manager[row.field_key] = row.manager_mode;
    }
  return {
    project_id: projectId,
    company,
    effective,
    fields: fieldKeys.map((field_key) => {
      const row = scoped.find((row) => row.field_key === field_key);
      return {
        field_key,
        driver_mode: row?.driver_mode ?? null,
        manager_mode: row?.manager_mode ?? null,
        version: row?.version ?? 0,
      };
    }),
  };
}
async function resolveAdmin(ctx: Context, projectId: string | null): Promise<AdminFieldSettings> {
  const settings = await resolve(ctx, projectId);
  const pending = await ctx.db
    .select({ id: vehicleUses.id, project_id: vehicleUses.project_id, fix_items: useRevisions.fix_items })
    .from(vehicleUses)
    .innerJoin(
      useRevisions,
      and(
        eq(useRevisions.vehicle_use_id, vehicleUses.id),
        eq(useRevisions.revision_no, vehicleUses.current_revision_no),
      ),
    )
    .where(
      and(
        eq(vehicleUses.review_status, 'NEEDS_FIX'),
        ne(vehicleUses.operation_status, 'CANCELED'),
        eq(useRevisions.decision, 'NEEDS_FIX'),
        projectId ? eq(vehicleUses.project_id, projectId) : undefined,
      ),
    );
  const pending_fixes: AdminFieldSettings['pending_fixes'] = {};
  if (pending.length) {
    const charges = await ctx.db
      .select()
      .from(chargeLines)
      .where(
        and(
          inArray(
            chargeLines.vehicle_use_id,
            pending.map((use) => use.id),
          ),
          isNull(chargeLines.deleted_at),
        ),
      );
    const overrides = projectId
      ? []
      : await ctx.db
          .select()
          .from(formFieldSettings)
          .where(inArray(formFieldSettings.project_id, [...new Set(pending.map((use) => use.project_id))]));
    for (const use of pending) {
      // A company change only affects fields that inherit the company's driver mode.
      const useCharges = charges.filter((line) => line.vehicle_use_id === use.id);
      const keys = new Set(use.fix_items.map((fix) => fieldKeyForFixTarget(fix.target, useCharges)));
      for (const key of keys) {
        if (
          !key ||
          overrides.some(
            (row) => row.project_id === use.project_id && row.field_key === key && row.driver_mode !== null,
          )
        )
          continue;
        pending_fixes[key] = (pending_fixes[key] ?? 0) + 1;
      }
    }
  }
  return { ...settings, pending_fixes };
}
export async function getEffectiveFormSettings(
  ctx: Context,
  projectId: string,
): Promise<EffectiveFieldSettings> {
  uuid.parse(projectId);
  await checkProject(ctx, projectId);
  const settings = await resolve(ctx, projectId);
  return {
    project_id: projectId,
    modes: settings.effective[ctx.user.role === 'DRIVER' ? 'driver' : 'manager'],
    ...(ctx.user.role !== 'DRIVER' ? { driver_modes: settings.effective.driver } : {}),
  };
}
export async function getAdminFormSettings(ctx: Context, projectId: string | null = null) {
  await assertActive(ctx);
  assertAdmin(ctx);
  if (projectId) {
    uuid.parse(projectId);
    await checkProject(ctx, projectId);
  }
  return resolveAdmin(ctx, projectId);
}
export async function saveFormSettings(ctx: Context, raw: unknown) {
  return ctx.db.transaction(async (db) => {
    const tx = { ...ctx, db };
    await assertActive(tx);
    assertAdmin(tx);
    const input = saveFormSettingsSchema.parse(raw);
    if (input.project_id) await checkProject(tx, input.project_id);
    // Also serialize first writes and inheritance resets, where no row may exist yet.
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('w9:form-settings', 0))`);
    const currentRows = await db
      .select()
      .from(formFieldSettings)
      .where(
        input.project_id
          ? eq(formFieldSettings.project_id, input.project_id)
          : isNull(formFieldSettings.project_id),
      );
    const previous = new Map(currentRows.map((row) => [row.field_key, row]));
    // Validate the whole batch before writing. Conflict details must only contain committed values.
    if (input.fields.some((field) => (previous.get(field.field_key)?.version ?? 0) !== field.version))
      throw new AppError(
        'VERSION_CONFLICT',
        '입력 항목 설정이 변경되었습니다. 최신 설정을 불러온 뒤 다시 저장하세요.',
        {
          current: await resolveAdmin(tx, input.project_id),
        },
      );
    const [project] = input.project_id
      ? await db.select({ name: projects.name }).from(projects).where(eq(projects.id, input.project_id))
      : [];
    const project_name = project?.name ?? '회사 기본값';
    for (const field of input.fields) {
      const before = previous.get(field.field_key);
      const values = {
        ...field,
        project_id: input.project_id,
        version: field.version + 1,
        updated_by: tx.user.id,
        updated_at: new Date(),
      };
      // Keep an inherited row's version so reset → edit cannot accept an old version (ABA).
      const [after] = before
        ? await db
            .update(formFieldSettings)
            .set(values)
            .where(eq(formFieldSettings.id, before.id))
            .returning()
        : await db.insert(formFieldSettings).values(values).returning();
      await audit(
        tx,
        'FORM_FIELDS_UPDATE',
        'form_field_setting',
        after.id,
        before ? { ...before, project_name } : null,
        { ...after, project_name },
      );
    }
    return resolveAdmin(tx, input.project_id);
  });
}
