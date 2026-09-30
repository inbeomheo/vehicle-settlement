import { withRoute } from '@/server/http';
import { getSummary } from '@/server/services/summary';
export const GET = withRoute(({ ctx, input }) => getSummary(ctx, input), { source: 'query' });
