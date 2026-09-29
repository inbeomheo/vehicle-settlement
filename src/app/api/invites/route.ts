import { withRoute } from '@/server/http';
export const runtime = 'nodejs';
import { listInvites, createInvite } from '@/server/services/auth';
import { inviteSchema } from '@/server/services/schemas';
export const GET = withRoute(async ({ ctx }) => listInvites(ctx), { roles: ['ADMIN'] });
export const POST = withRoute(async ({ ctx, input }) => createInvite(ctx, input), {
  schema: inviteSchema,
  idempotent: true,
  roles: ['ADMIN'],
});
