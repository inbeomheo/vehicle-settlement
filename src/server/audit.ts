import { auditLogs } from './db/schema';
import type { Context } from './context';
export async function audit(
  ctx: Context,
  action: string,
  entityType: string,
  entityId: string | null,
  before: unknown = null,
  after: unknown = null,
  reason?: string | null,
) {
  await ctx.db.insert(auditLogs).values({
    user_id: ctx.user.id,
    action,
    entity_type: entityType,
    entity_id: entityId,
    before,
    after,
    reason,
    request_id: ctx.request_id,
  });
}
