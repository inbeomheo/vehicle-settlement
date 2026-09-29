import { withRoute } from '@/server/http';
import { deleteStaleImportPreviews, listImports } from '@/server/services/import';
export const GET = withRoute(({ ctx }) => listImports(ctx), {
  roles: ['ADMIN', 'SITE_MANAGER', 'SETTLEMENT_MANAGER'],
});
export const DELETE = withRoute(({ ctx }) => deleteStaleImportPreviews(ctx), {
  roles: ['ADMIN', 'SITE_MANAGER', 'SETTLEMENT_MANAGER'],
  source: 'none',
  idempotent: true,
});
