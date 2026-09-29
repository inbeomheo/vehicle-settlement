import { withRoute } from '@/server/http';
import { confirmStatement } from '@/server/services/statements';
import { confirmStatementSchema } from '@/server/services/statements-schemas';
export const POST = withRoute(async ({ ctx, params, input }) => confirmStatement(ctx, params.id, input), {
  source: 'json',
  schema: confirmStatementSchema,
  idempotent: true,
  roles: ['ADMIN', 'SETTLEMENT_MANAGER'],
});
