import { withRoute } from '@/server/http';
export const runtime = 'nodejs';
import { lookupRate } from '@/server/services/rates';
import { rateLookupSchema } from '@/server/services/schemas';
export const GET = withRoute(async ({ ctx, input }) => lookupRate(ctx, input), { schema: rateLookupSchema, source: 'query' });
