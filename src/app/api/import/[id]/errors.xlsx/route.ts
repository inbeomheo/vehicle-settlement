import { withRoute } from '@/server/http';
import { importErrors } from '@/server/services/import';
export const GET = withRoute(
  async ({ ctx, params }) =>
    new Response(new Uint8Array(await importErrors(ctx, params.id)), {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': 'attachment; filename="import-errors.xlsx"',
      },
    }),
  { roles: ['ADMIN', 'SITE_MANAGER', 'SETTLEMENT_MANAGER'] },
);
