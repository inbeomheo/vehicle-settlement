import { withRoute } from '@/server/http';
import { statementCandidates } from '@/server/services/statements';
import { candidateSchema } from '@/server/services/statements-schemas';
export const GET = withRoute(async ({ ctx, input }) => statementCandidates(ctx, input), {
  source: 'query',
  schema: candidateSchema,
});
