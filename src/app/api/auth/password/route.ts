import { withRoute } from '@/server/http';
import { changePassword, changePasswordSchema } from '@/server/services/password';
export const runtime = 'nodejs';
// No outer idempotency transaction: failed verification counters must commit.
export const POST = withRoute(({ ctx, input }) => changePassword(ctx, input), {
  schema: changePasswordSchema,
});
