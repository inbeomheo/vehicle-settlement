import { withRoute } from '@/server/http';
import { deleteStaleImportPreviews, deleteStaleImportSchema, listImports } from '@/server/services/import';
export const GET = withRoute(({ ctx }) => listImports(ctx), {
  roles: ['ADMIN', 'SITE_MANAGER', 'SETTLEMENT_MANAGER'],
});
export const DELETE = withRoute(({ ctx, input }) => deleteStaleImportPreviews(ctx, input), {
  roles: ['ADMIN', 'SITE_MANAGER', 'SETTLEMENT_MANAGER'],
  schema: deleteStaleImportSchema,
  idempotent: true,
});
