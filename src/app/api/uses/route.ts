import { withRoute } from '@/server/http';
export const runtime = 'nodejs';
import { createUse, listUses } from '@/server/services/uses';
import { createUseSchema, listUsesSchema } from '@/server/services/schemas';
export const GET = withRoute(async ({ ctx, input }) => listUses(ctx, input), { schema: listUsesSchema, source: 'query' });
export const POST = withRoute(async ({ ctx, input }) => createUse(ctx, input), { schema: createUseSchema, idempotent: true });
