import { withRoute } from '@/server/http';
import { updateUser } from '@/server/services/admin';
export const PATCH = withRoute(({ ctx, input, params }) => updateUser(ctx, params.id, input), {
  idempotent: true,
  roles: ['ADMIN'],
});
