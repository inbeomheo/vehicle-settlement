import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { projects } from '../db/schema';
import { invalid } from '../errors';

// Call within the registration transaction. SHARE also blocks an active-state
// update until account creation and assignment have committed.
export async function activeInvitationProjectIds(db: Db, ids: string[]) {
  const rows = ids.length
    ? await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(inArray(projects.id, ids), eq(projects.active, true)))
        .orderBy(projects.id)
        .for('share')
    : [];
  if (!rows.length) invalid('초대한 현장이 지금 사용 중지 상태예요. 관리자에게 새 초대를 요청해 주세요.');
  return rows.map((row) => row.id);
}
