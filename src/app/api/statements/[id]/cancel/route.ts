import { withRoute } from '@/server/http';
import { cancelStatement } from '@/server/services/statements';
import { cancelStatementSchema } from '@/server/services/statements-schemas';
export const POST = withRoute(async ({ ctx, params, input }) => cancelStatement(ctx, params.id, input), {
  source: 'json',
  schema: cancelStatementSchema,
  idempotent: true,
  roles: ['ADMIN', 'SETTLEMENT_MANAGER'],
});
