import { withRoute } from '@/server/http';
import { addAssignment } from '@/server/services/admin';
import { projectAssignments } from '@/server/db/schema';
export const GET = withRoute(({ db }) => db.select().from(projectAssignments), { roles: ['ADMIN'] });
export const POST = withRoute(({ ctx, input }) => addAssignment(ctx, input), {
  idempotent: true,
  roles: ['ADMIN'],
});
