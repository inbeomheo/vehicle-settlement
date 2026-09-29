import { withRoute, json } from '@/server/http';
export const runtime = 'nodejs';
import { acceptInvite } from '@/server/services/auth';
import { acceptInviteSchema } from '@/server/services/schemas';
import { sessionCookie } from '@/server/auth/session';
export const POST = withRoute(async ({ db, request_id, params, input }) => { const r = await acceptInvite(db, request_id, params.id, input); return json(r.user, 200, { 'set-cookie': sessionCookie(r.token) }); }, { auth: false, schema: acceptInviteSchema });
