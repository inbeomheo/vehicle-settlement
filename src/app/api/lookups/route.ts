import { withRoute } from '@/server/http';
export const runtime = 'nodejs';
import { getLookups } from '@/server/services/lookups';
export const GET = withRoute(async ({ ctx }) => getLookups(ctx));
