import { withRoute } from '@/server/http';
export const runtime = 'nodejs';
import { confirmByDriver } from '@/server/services/uses';
import { versionInput, uuid } from '@/server/services/schemas';
export const POST = withRoute(
  async ({ ctx, params, input }) => confirmByDriver(ctx, uuid.parse(params.id), input),
  { schema: versionInput, idempotent: true },
);
