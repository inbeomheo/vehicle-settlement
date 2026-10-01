import { notFound } from '@/server/errors';
import { withRoute } from '@/server/http';
import { deleteProject, saveMaster, masterResource } from '@/server/services/admin';
export const PATCH = withRoute(
  ({ ctx, params, input }) => saveMaster(ctx, masterResource(params.resource), input, params.id),
  { idempotent: true, roles: ['ADMIN'] },
);

export const DELETE = withRoute(
  ({ ctx, params }) => {
    if (masterResource(params.resource) !== 'projects') notFound();
    return deleteProject(ctx, params.id);
  },
  { idempotent: true, roles: ['ADMIN'] },
);
