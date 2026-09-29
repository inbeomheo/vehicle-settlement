import { withRoute } from '@/server/http';
export const runtime = 'nodejs';
import { copyUse } from '@/server/services/uses';
import { copySchema, uuid } from '@/server/services/schemas';
export const POST = withRoute(async ({ ctx, params, input }) => copyUse(ctx, uuid.parse(params.id), input), {
  schema: copySchema,
  idempotent: true,
});
