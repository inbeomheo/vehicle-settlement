import { withRoute, json } from '@/server/http';
export const runtime = 'nodejs';
import { login } from '@/server/services/auth';
import { sessionCookie } from '@/server/auth/session';
import { loginSchema } from '@/server/services/schemas';
export const POST = withRoute(async ({ db, request_id, input }) => { const r = await login(db, request_id, input); return json(r.user, 200, { 'set-cookie': sessionCookie(r.token) }); }, { auth: false, schema: loginSchema });
