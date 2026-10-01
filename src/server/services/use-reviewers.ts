import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { assertCanReview, assertProjectAccess } from '../authz';
import type { Context } from '../context';
import { projects, users, vehicleUses } from '../db/schema';
import { AppError, invalid, notFound } from '../errors';
import { uuid } from './schemas';

export async function eligibleReviewers(ctx: Context, projectId: string) {
  await assertProjectAccess(ctx, projectId);
  const candidates = await ctx.db
    .select()
    .from(users)
    .where(
      and(eq(users.status, 'ACTIVE'), inArray(users.role, ['ADMIN', 'SITE_MANAGER', 'SETTLEMENT_MANAGER'])),
    )
    .orderBy(asc(users.name), asc(users.id));
  const result: { id: string; name: string; role: typeof users.$inferSelect.role }[] = [];
  for (const user of candidates) {
    try {
      await assertCanReview({ ...ctx, user }, { project_id: projectId, driver_id: '' });
      result.push({ id: user.id, name: user.name, role: user.role });
    } catch (error) {
      if (!(error instanceof AppError) || !['NOT_FOUND', 'FORBIDDEN', 'UNAUTHENTICATED'].includes(error.code))
        throw error;
    }
  }
  return result;
}
export async function validateReviewer(ctx: Context, projectId: string, id: string) {
  await assertProjectAccess(ctx, projectId);
  const [user] = await ctx.db.select().from(users).where(eq(users.id, id));
  if (user && user.status === 'ACTIVE' && user.role !== 'DRIVER') {
    try {
      await assertCanReview({ ...ctx, user }, { project_id: projectId, driver_id: '' });
      return { id: user.id, name: user.name, role: user.role };
    } catch (error) {
      if (!(error instanceof AppError) || !['NOT_FOUND', 'FORBIDDEN', 'UNAUTHENTICATED'].includes(error.code))
        throw error;
    }
  }
  invalid('이 현장을 검수할 수 있는 활성 담당자를 선택하세요.', {
    fields: [{ target: 'reviewer', reason: '담당자의 현장 배정과 사용 상태를 확인하세요.' }],
  });
}
export async function getUseReviewers(ctx: Context, raw: unknown) {
  const input = z.object({ project_id: uuid, driver_id: uuid.optional() }).parse(raw);
  await assertProjectAccess(ctx, input.project_id);
  const [project] = await ctx.db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, input.project_id));
  if (!project) notFound();
  const reviewers = await eligibleReviewers(ctx, input.project_id);
  const driverId = ctx.user.role === 'DRIVER' ? ctx.user.driver_id : input.driver_id;
  if (ctx.user.role === 'DRIVER' && input.driver_id && input.driver_id !== ctx.user.driver_id) notFound();
  const recent = driverId
    ? await ctx.db
        .select({ reviewer_user_id: vehicleUses.reviewer_user_id, load_tonnage: vehicleUses.load_tonnage })
        .from(vehicleUses)
        .where(
          and(
            eq(vehicleUses.project_id, input.project_id),
            eq(vehicleUses.driver_id, driverId),
            ne(vehicleUses.operation_status, 'CANCELED'),
          ),
        )
        .orderBy(desc(vehicleUses.created_at), desc(vehicleUses.id))
        .limit(30)
    : [];
  return {
    reviewers,
    default_reviewer_id:
      recent.find((row) => reviewers.some((user) => user.id === row.reviewer_user_id))?.reviewer_user_id ??
      null,
    recent_loads: [
      ...new Set(recent.map((row) => row.load_tonnage).filter((value): value is string => value !== null)),
    ].slice(0, 5),
  };
}
