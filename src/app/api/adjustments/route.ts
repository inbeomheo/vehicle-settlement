import { withRoute } from '@/server/http';
import { createAdjustment } from '@/server/services/adjustments';
import { adjustmentSchema } from '@/server/services/statements-schemas';
export const POST = withRoute(async ({ ctx, input }) => createAdjustment(ctx, input), {
  source: 'json',
  schema: adjustmentSchema,
  idempotent: true,
  roles: ['ADMIN', 'SETTLEMENT_MANAGER'],
});
