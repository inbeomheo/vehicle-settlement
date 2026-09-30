import { withRoute } from '@/server/http';
import { getPasswordResetStatus, resetPassword, resetPasswordSchema } from '@/server/services/password';
export const runtime = 'nodejs';
export const GET = withRoute(({ db, params }) => getPasswordResetStatus(db, params.token), { auth: false });
export const POST = withRoute(
  ({ db, request_id, params, input }) => resetPassword(db, request_id, params.token, input),
  { auth: false, schema: resetPasswordSchema },
);
