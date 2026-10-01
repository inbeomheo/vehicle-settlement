import { withRoute } from '@/server/http';
import { exportApprovals } from '@/server/services/approvals-export';
export const GET = withRoute(
  async ({ ctx, input }) =>
    new Response(await exportApprovals(ctx, input), {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename=approvals.xlsx; filename*=UTF-8''${encodeURIComponent('운행결재.xlsx')}`,
      },
    }),
  { source: 'query' },
);
