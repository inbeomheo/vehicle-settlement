import { withRoute } from '@/server/http';
import { queryAudit } from '@/server/services/audit-query';
export const GET = withRoute(({ ctx, input }) => queryAudit(ctx, input), { source: 'query' });
