import { withRoute } from '@/server/http';
import { getClosingPeriodSettings } from '@/server/services/closing-period';
export const runtime = 'nodejs';
export const GET = withRoute(async ({ ctx }) => getClosingPeriodSettings(ctx));
