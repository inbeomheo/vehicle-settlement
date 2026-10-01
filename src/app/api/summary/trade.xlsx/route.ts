import { withRoute } from '@/server/http';
import { exportSummaryTrade } from '@/server/services/summary-trade-export';
export const GET = withRoute(
  async ({ ctx, input }) => {
    const file = await exportSummaryTrade(ctx, input);
    return new Response(file.bytes, {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename=trade.xlsx; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        'cache-control': 'no-store',
      },
    });
  },
  { source: 'query' },
);
