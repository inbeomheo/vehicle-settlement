import { withRoute } from '@/server/http';
import { updateStatement } from '@/server/services/statements';
import { updateStatementSchema } from '@/server/services/statements-schemas';
export const PATCH = withRoute(async ({ ctx, params, input }) => updateStatement(ctx, params.id, input), {
  source: 'json',
  schema: updateStatementSchema,
  idempotent: true,
  roles: ['ADMIN', 'SETTLEMENT_MANAGER'],
});
