import { withRoute } from '@/server/http';
import { exportUseReport } from '@/server/services/use-report';
export const runtime = 'nodejs';
export const GET = withRoute(({ ctx, params }) => exportUseReport(ctx, params.id), { source: 'none' });
