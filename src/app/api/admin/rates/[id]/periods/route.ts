import { withRoute } from '@/server/http';
import { addRatePeriod } from '@/server/services/admin-rates';
export const POST = withRoute(({ ctx, input, params }) => addRatePeriod(ctx, params.id, input), {
  idempotent: true,
  roles: ['ADMIN'],
});
