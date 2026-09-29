import { withRoute } from '@/server/http';
import { saveMaster, masterResource } from '@/server/services/admin';
export const PATCH = withRoute(
  ({ ctx, params, input }) => saveMaster(ctx, masterResource(params.resource), input, params.id),
  { idempotent: true, roles: ['ADMIN'] },
);
