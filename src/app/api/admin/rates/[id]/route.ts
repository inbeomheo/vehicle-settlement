import { withRoute } from '@/server/http';
import { saveRate } from '@/server/services/admin-rates';
export const PATCH = withRoute(({ ctx, input, params }) => saveRate(ctx, input, params.id), {
  idempotent: true,
  roles: ['ADMIN'],
});
