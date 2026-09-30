import { withRoute } from '@/server/http';
import { exportSummary } from '@/server/services/summary-export';
export const GET = withRoute(
  async ({ ctx, input }) => {
    const file = await exportSummary(ctx, input);
    return new Response(file.bytes, {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename=summary.xlsx; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        'cache-control': 'no-store',
      },
    });
  },
  { source: 'query' },
);
