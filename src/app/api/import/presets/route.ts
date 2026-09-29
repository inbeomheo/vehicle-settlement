import { withRoute } from '@/server/http';
import { listImportPresets, saveImportPreset } from '@/server/services/import';
import { presetSchema } from '@/server/services/import-fields';
export const GET = withRoute(({ ctx }) => listImportPresets(ctx), {
  roles: ['ADMIN', 'SITE_MANAGER', 'SETTLEMENT_MANAGER'],
});
export const POST = withRoute(({ ctx, input }) => saveImportPreset(ctx, input), {
  schema: presetSchema,
  idempotent: true,
  roles: ['ADMIN', 'SITE_MANAGER', 'SETTLEMENT_MANAGER'],
});
