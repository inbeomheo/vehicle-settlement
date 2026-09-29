import { withRoute } from '@/server/http';
export const runtime = 'nodejs';
import { getUse, updateUse } from '@/server/services/uses';
import { updateUseSchema, uuid } from '@/server/services/schemas';
export const GET = withRoute(async ({ ctx, params }) => getUse(ctx, uuid.parse(params.id)));
export const PATCH = withRoute(async ({ ctx, params, input }) => updateUse(ctx, uuid.parse(params.id), input), { schema: updateUseSchema, idempotent: true });
