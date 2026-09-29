import { and, eq, inArray } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { guardPage } from '@/server/auth/page';
import { accessibleProjectIds } from '@/server/authz';
import { getDb } from '@/server/db/client';
import { projects } from '@/server/db/schema';
import { uuid } from '@/server/services/schemas';

export type ManagerSearchParams = Record<string, string | string[] | undefined>;
export async function projectFromQuery(query: ManagerSearchParams, pathname: string, activeOnly = false) {
  if (query.project === undefined) return '';
  const candidate = uuid.safeParse(query.project);
  if (candidate.success) {
    const user = await guardPage('manager');
    const db = getDb();
    const ids = await accessibleProjectIds({ db, user, request_id: crypto.randomUUID() });
    const [project] =
      ids?.length === 0
        ? []
        : await db
            .select({ id: projects.id })
            .from(projects)
            .where(
              and(
                eq(projects.id, candidate.data),
                activeOnly ? eq(projects.active, true) : undefined,
                ids ? inArray(projects.id, ids) : undefined,
              ),
            );
    if (project) return project.id;
  }
  const clean = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key === 'project' || value === undefined) continue;
    for (const entry of Array.isArray(value) ? value : [value]) clean.append(key, entry);
  }
  redirect(pathname + (clean.size ? `?${clean}` : ''));
}
