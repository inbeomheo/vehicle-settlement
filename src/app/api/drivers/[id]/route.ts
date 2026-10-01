import { withRoute } from '@/server/http';
import { getDriverProfile, updateDriverProfile } from '@/server/services/driver-profiles';
export const GET = withRoute(({ ctx, params }) => getDriverProfile(ctx, params.id), {
  roles: ['ADMIN', 'SITE_MANAGER', 'SETTLEMENT_MANAGER'],
});
export const PATCH = withRoute(({ ctx, params, input }) => updateDriverProfile(ctx, params.id, input), {
  roles: ['ADMIN'],
  idempotent: true,
});
