import { withRoute } from '@/server/http';
import { getApprovals } from '@/server/services/approvals';
export const GET = withRoute(({ ctx, input }) => getApprovals(ctx, input), { source: 'query' });
