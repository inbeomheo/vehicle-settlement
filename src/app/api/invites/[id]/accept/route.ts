import { withRoute, json } from '@/server/http';
export const runtime = 'nodejs';
import { acceptInvite } from '@/server/services/auth';
import { z } from 'zod';
import { registerDriver, registerDriverSchema } from '@/server/services/driver-join';
import { acceptInviteSchema } from '@/server/services/schemas';
import { sessionCookie } from '@/server/auth/session';
export const POST = withRoute(
  async ({ db, request_id, params, input }) => {
    const r =
      'profile' in input
        ? await registerDriver(db, request_id, params.id, input, true)
        : await acceptInvite(db, request_id, params.id, input);
    return json(r.user, 200, { 'set-cookie': sessionCookie(r.token) });
  },
  { auth: false, schema: z.union([registerDriverSchema, acceptInviteSchema]) },
);
