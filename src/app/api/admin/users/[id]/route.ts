import { deleteUser } from '@/server/services/user-deletion';
import { withRoute } from '@/server/http';
import { updateUser } from '@/server/services/admin';
export const PATCH = withRoute(({ ctx, input, params }) => updateUser(ctx, params.id, input), {
  idempotent: true,
  roles: ['ADMIN'],
});

export const DELETE = withRoute(({ ctx, input, params }) => deleteUser(ctx, params.id, input), {
  idempotent: true,
  roles: ['ADMIN'],
});
