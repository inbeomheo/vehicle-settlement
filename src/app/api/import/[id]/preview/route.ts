import { withRoute } from '@/server/http';
import { previewImport } from '@/server/services/import';
import { previewSchema } from '@/server/services/import-fields';
export const POST = withRoute(({ ctx, params, input }) => previewImport(ctx, params.id, input), {
  schema: previewSchema,
});
