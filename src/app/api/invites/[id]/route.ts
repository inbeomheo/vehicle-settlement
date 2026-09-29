import { withRoute } from '@/server/http';
export const runtime = 'nodejs';
import { revokeInvite } from '@/server/services/auth';
import { uuid } from '@/server/services/schemas';
export const DELETE = withRoute(async ({ ctx, params }) => revokeInvite(ctx, uuid.parse(params.id)), { idempotent: true, roles: ['ADMIN'] });
