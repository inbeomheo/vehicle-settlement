import { withRoute } from '@/server/http';
import { listStatements } from '@/server/services/statements';
import { statementListSchema } from '@/server/services/statements-schemas';
import { createStatement } from '@/server/services/statements';
import { createStatementSchema } from '@/server/services/statements-schemas';
export const GET = withRoute(async ({ ctx, input }) => listStatements(ctx, input), {
  source: 'query',
  schema: statementListSchema,
});
export const POST = withRoute(async ({ ctx, input }) => createStatement(ctx, input), {
  source: 'json',
  schema: createStatementSchema,
  idempotent: true,
  roles: ['ADMIN', 'SETTLEMENT_MANAGER'],
});
