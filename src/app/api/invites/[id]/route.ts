import { withRoute } from '@/server/http';
export const runtime = 'nodejs';
import { getInviteStatus, revokeInvite } from '@/server/services/auth';
import { uuid } from '@/server/services/schemas';
export const GET = withRoute(({ db, params }) => getInviteStatus(db, params.id), {
  auth: false,
  source: 'none',
});
export const DELETE = withRoute(async ({ ctx, params }) => revokeInvite(ctx, uuid.parse(params.id)), {
  idempotent: true,
  roles: ['ADMIN'],
});
