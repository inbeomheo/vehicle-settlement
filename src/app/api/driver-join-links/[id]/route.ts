import { withRoute } from '@/server/http';
import { revokeJoinLink } from '@/server/services/driver-join';
export const DELETE = withRoute(({ ctx, params, input }) => revokeJoinLink(ctx, params.id, input), {
  roles: ['ADMIN'],
  idempotent: true,
});
