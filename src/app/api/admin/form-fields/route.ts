import { withRoute } from '@/server/http';
import { formSettingsQuery, getAdminFormSettings, saveFormSettings } from '@/server/services/form-settings';
export const GET = withRoute(({ ctx, input }) => getAdminFormSettings(ctx, input.project_id), {
  source: 'query',
  schema: formSettingsQuery,
  roles: ['ADMIN'],
});
export const PUT = withRoute(({ ctx, input }) => saveFormSettings(ctx, input), {
  idempotent: true,
  roles: ['ADMIN'],
});
