import { json, withRoute } from '@/server/http';
import { sessionCookie } from '@/server/auth/session';
import { registerDriver, registerDriverSchema } from '@/server/services/driver-join';
export const POST = withRoute(
  async ({ db, request_id, params, input }) => {
    const result = await registerDriver(db, request_id, params.token, input);
    return json(result.user, 200, { 'set-cookie': sessionCookie(result.token) });
  },
  { auth: false, schema: registerDriverSchema },
);
