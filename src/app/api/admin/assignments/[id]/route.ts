import { withRoute } from '@/server/http';
import { revokeAssignment } from '@/server/services/admin';
export const DELETE = withRoute(({ ctx, params }) => revokeAssignment(ctx, params.id), {
  idempotent: true,
  roles: ['ADMIN'],
});
