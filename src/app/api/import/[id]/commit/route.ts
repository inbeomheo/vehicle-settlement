import { withRoute } from '@/server/http';
import { commitImport } from '@/server/services/import';
// The locked job and unique source hash provide durable idempotency with fresh authorization.
export const POST = withRoute(({ ctx, params }) => commitImport(ctx, params.id), {
  roles: ['ADMIN', 'SITE_MANAGER', 'SETTLEMENT_MANAGER'],
});
