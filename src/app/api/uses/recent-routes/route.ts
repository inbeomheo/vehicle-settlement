import { withRoute } from '@/server/http';
import { getRecentRoutes } from '@/server/services/ledger-recent';
export const GET = withRoute(({ ctx, input }) => getRecentRoutes(ctx, input), { source: 'query' });
