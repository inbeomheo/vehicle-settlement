import { withRoute } from '@/server/http';
import {
  getDriverProfile,
  updateDriverProfile,
  updateDriverAffiliation,
} from '@/server/services/driver-profiles';
export const GET = withRoute(({ ctx, params }) => getDriverProfile(ctx, params.id), {
  roles: ['ADMIN', 'SITE_MANAGER', 'SETTLEMENT_MANAGER'],
});
export const PATCH = withRoute(
  ({ ctx, params, input }) =>
    input && typeof input === 'object' && 'affiliation_id' in input
      ? updateDriverAffiliation(ctx, params.id, input)
      : updateDriverProfile(ctx, params.id, input),
  {
    roles: ['ADMIN', 'SETTLEMENT_MANAGER'],
    idempotent: true,
  },
);
