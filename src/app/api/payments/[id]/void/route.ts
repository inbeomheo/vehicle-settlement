import { withRoute } from '@/server/http';
import { voidPayment } from '@/server/services/payments';
import { voidPaymentSchema } from '@/server/services/statements-schemas';
export const POST = withRoute(async ({ ctx, params, input }) => voidPayment(ctx, params.id, input), {
  source: 'json',
  schema: voidPaymentSchema,
  idempotent: true,
  roles: ['ADMIN', 'SETTLEMENT_MANAGER'],
});
