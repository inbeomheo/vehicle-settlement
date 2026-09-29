import { withRoute } from '@/server/http';
import { driverSettlements } from '@/server/services/statements-driver';
import { driverSettlementSchema } from '@/server/services/statements-schemas';
export const GET = withRoute(async ({ ctx, input }) => driverSettlements(ctx, input), {
  source: 'query',
  schema: driverSettlementSchema,
});
