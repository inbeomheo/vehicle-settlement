import { withUsePush } from '@/server/push/route';
import { withRoute } from '@/server/http';
export const runtime = 'nodejs';
import { submitUse } from '@/server/services/uses';
import { versionInput, uuid } from '@/server/services/schemas';
export const POST = withUsePush(
  withRoute(async ({ ctx, params, input }) => submitUse(ctx, uuid.parse(params.id), input), {
    schema: versionInput,
    idempotent: true,
  }),
  'SUBMITTED',
);
