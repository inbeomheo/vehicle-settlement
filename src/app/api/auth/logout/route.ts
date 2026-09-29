import { withRoute, json } from '@/server/http';
export const runtime = 'nodejs';
import { logout } from '@/server/services/auth';
import { sessionCookie } from '@/server/auth/session';
export const POST = withRoute(
  async ({ ctx }) => json(await logout(ctx), 200, { 'set-cookie': sessionCookie('', true) }),
  { idempotent: true },
);
