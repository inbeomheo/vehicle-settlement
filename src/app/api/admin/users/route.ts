import { withRoute } from '@/server/http';
import { listUsers } from '@/server/services/admin';
export const GET = withRoute(({ ctx }) => listUsers(ctx), { roles: ['ADMIN'] });
