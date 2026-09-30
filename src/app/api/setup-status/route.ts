import { withRoute } from '@/server/http';
import { getSetupStatus } from '@/server/services/setup-status';
export const GET = withRoute(({ ctx }) => getSetupStatus(ctx), { roles: ['ADMIN'] });
