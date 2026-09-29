import { withRoute } from '@/server/http';
import { exportLedger } from '@/server/services/ledger-export';
export const GET = withRoute(
  async ({ ctx, input }) =>
    new Response(await exportLedger(ctx, input), {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename=vehicle-ledger.xlsx; filename*=UTF-8''${encodeURIComponent('차량사용대장.xlsx')}`,
      },
    }),
  { source: 'query' },
);
