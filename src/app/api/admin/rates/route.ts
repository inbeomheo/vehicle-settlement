import { withRoute } from '@/server/http';
import { listRates, saveRate } from '@/server/services/admin-rates';
export const GET = withRoute(({ ctx }) => listRates(ctx));
export const POST = withRoute(({ ctx, input }) => saveRate(ctx, input), {
  idempotent: true,
  roles: ['ADMIN'],
});
