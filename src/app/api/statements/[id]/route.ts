import { withRoute } from '@/server/http';
import { getStatement } from '@/server/services/statements';
export const GET = withRoute(async ({ ctx, params }) => getStatement(ctx, params.id), { source: 'none' });
