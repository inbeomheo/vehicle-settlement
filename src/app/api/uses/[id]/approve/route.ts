import { withRoute } from '@/server/http';
export const runtime = 'nodejs';
import { approveUse } from '@/server/services/uses';
import { approveSchema, uuid } from '@/server/services/schemas';
export const POST = withRoute(async ({ ctx, params, input }) => approveUse(ctx, uuid.parse(params.id), input), { schema: approveSchema, idempotent: true });
