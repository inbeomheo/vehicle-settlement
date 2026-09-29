import { withRoute } from '@/server/http';
import { getImport } from '@/server/services/import';
export const GET = withRoute(({ ctx, params }) => getImport(ctx, params.id), {
  roles: ['ADMIN', 'SITE_MANAGER', 'SETTLEMENT_MANAGER'],
});
