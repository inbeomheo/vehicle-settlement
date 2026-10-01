import { withRoute } from '@/server/http';
import { importPageSchema } from '@/server/services/import-fields';
import { getImport } from '@/server/services/import';
export const GET = withRoute(({ ctx, params, input }) => getImport(ctx, params.id, input), {
  source: 'query',
  schema: importPageSchema,
  roles: ['ADMIN', 'SITE_MANAGER', 'SETTLEMENT_MANAGER'],
});
