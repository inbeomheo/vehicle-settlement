import { withUsePush } from '@/server/push/route';
import { withRoute } from '@/server/http';
export const runtime = 'nodejs';
import { requestFix } from '@/server/services/uses';
import { fixSchema, uuid } from '@/server/services/schemas';
export const POST = withUsePush(
  withRoute(async ({ ctx, params, input }) => requestFix(ctx, uuid.parse(params.id), input), {
    schema: fixSchema,
    idempotent: true,
    roles: ['ADMIN', 'SITE_MANAGER', 'SETTLEMENT_MANAGER'],
  }),
  'NEEDS_FIX',
);
