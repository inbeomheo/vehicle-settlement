import { withRoute } from '@/server/http';
import { recordPayment } from '@/server/services/payments';
import { paymentSchema } from '@/server/services/statements-schemas';
export const POST = withRoute(async ({ ctx, params, input }) => recordPayment(ctx, params.id, input), {
  source: 'json',
  schema: paymentSchema,
  idempotent: true,
  roles: ['ADMIN', 'SETTLEMENT_MANAGER'],
});
