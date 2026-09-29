import { withRoute } from '@/server/http';
import { paymentOverview } from '@/server/services/payments';
import { paymentOverviewSchema } from '@/server/services/statements-schemas';
export const GET = withRoute(async ({ ctx, input }) => paymentOverview(ctx, input), {
  source: 'query',
  schema: paymentOverviewSchema,
});
