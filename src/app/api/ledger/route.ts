import { withRoute } from '@/server/http';
import { getLedger } from '@/server/services/ledger';
export const GET = withRoute(({ ctx, input }) => getLedger(ctx, input), { source: 'query' });
