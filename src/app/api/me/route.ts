import { withRoute } from '@/server/http';
export const runtime = 'nodejs';
import { publicUser } from '@/server/auth/session';
export const GET = withRoute(async ({ ctx }) => publicUser(ctx.user));
