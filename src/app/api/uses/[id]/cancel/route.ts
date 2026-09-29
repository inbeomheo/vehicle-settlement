import { withRoute } from '@/server/http';
export const runtime = 'nodejs';
import { cancelUse } from '@/server/services/uses';
import { reasonSchema, uuid } from '@/server/services/schemas';
export const POST = withRoute(
  async ({ ctx, params, input }) => cancelUse(ctx, uuid.parse(params.id), input),
  { schema: reasonSchema, idempotent: true },
);
