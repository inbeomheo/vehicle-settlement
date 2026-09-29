import { withRoute } from '@/server/http';
export const runtime = 'nodejs';
import { reviewChargeLine } from '@/server/services/uses';
import { uuid } from '@/server/services/schemas';
export const PATCH = withRoute(async ({ ctx, params, input }) => reviewChargeLine(ctx, uuid.parse(params.id), input), { idempotent: true });
