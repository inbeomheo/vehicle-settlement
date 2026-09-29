import { withRoute } from '@/server/http';
import { exportStatement } from '@/server/services/exports';
export const runtime = 'nodejs';
export const GET = withRoute(async ({ ctx, params }) => exportStatement(ctx, params.id, 'xlsx'), {
  source: 'none',
});
