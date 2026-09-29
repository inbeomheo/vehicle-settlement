import { withRoute } from '@/server/http';
import { listMaster, saveMaster, masterResource } from '@/server/services/admin';
export const GET = withRoute(({ ctx, params }) => listMaster(ctx, masterResource(params.resource)));
export const POST = withRoute(
  ({ ctx, params, input }) => saveMaster(ctx, masterResource(params.resource), input),
  { idempotent: true, roles: ['ADMIN'] },
);
