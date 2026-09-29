import { withRoute } from '@/server/http';
export const runtime = 'nodejs';
import { getLookups } from '@/server/services/lookups';
export const GET = withRoute(async ({ ctx, request }) =>
  getLookups(ctx, new URL(request.url).searchParams.get('use_date') ?? undefined),
);
