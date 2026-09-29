import { withRoute } from '@/server/http';
import { deleteStaleImportPreviews, listImports } from '@/server/services/import';
export const GET = withRoute(({ ctx }) => listImports(ctx));
export const DELETE = withRoute(({ ctx }) => deleteStaleImportPreviews(ctx), {
  source: 'none',
  idempotent: true,
});
