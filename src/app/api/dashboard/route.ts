import { withRoute } from '@/server/http';
import { getDashboard } from '@/server/services/dashboard';
export const GET = withRoute(({ ctx }) => getDashboard(ctx));
