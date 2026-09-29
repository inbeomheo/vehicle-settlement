import { z } from 'zod';
import { withRoute } from '@/server/http';
import { getEffectiveFormSettings } from '@/server/services/form-settings';
import { uuid } from '@/server/services/schemas';
export const GET = withRoute(({ ctx, input }) => getEffectiveFormSettings(ctx, input.project_id), {
  source: 'query',
  schema: z.object({ project_id: uuid }).strict(),
});
