import { withRoute } from '@/server/http';
import { listDriverProfiles } from '@/server/services/driver-profiles';
export const GET = withRoute(({ ctx }) => listDriverProfiles(ctx), {
  roles: ['ADMIN', 'SITE_MANAGER', 'SETTLEMENT_MANAGER'],
});
