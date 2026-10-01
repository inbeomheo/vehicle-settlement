import { withRoute } from '@/server/http';
import { getUseReviewers } from '@/server/services/use-reviewers';
export const GET = withRoute(({ ctx, input }) => getUseReviewers(ctx, input), { source: 'query' });
