import { json, withRoute } from '@/server/http';
import { getDriverProfile, updateDriverProfile } from '@/server/services/driver-profiles';
// Explicit self-only response: generic driver redaction hides all phone keys,
// but a driver must be able to read their own contact information here.
export const GET = withRoute(async ({ ctx }) => json(await getDriverProfile(ctx, ctx.user.id)), {
  roles: ['DRIVER'],
});
// Return an acknowledgement; the UI reloads the self-only GET after saving.
// This keeps generic idempotent replay redaction intact, including phone data.
export const PATCH = withRoute(
  async ({ ctx, input }) => {
    const result = await updateDriverProfile(ctx, ctx.user.id, input);
    return { id: result.id, version: result.version };
  },
  { roles: ['DRIVER'], idempotent: true },
);
