import { withRoute } from '@/server/http';
import { listMaster } from '@/server/services/admin';
export const GET = withRoute(async ({ ctx }) => {
  const [projects, drivers, vehicles, counterparties] = await Promise.all([
    listMaster(ctx, 'projects'),
    listMaster(ctx, 'drivers'),
    listMaster(ctx, 'vehicles'),
    listMaster(ctx, 'counterparties'),
  ]);
  return {
    projects,
    drivers,
    vehicles,
    counterparties: counterparties.filter((party) => party.kind !== 'CUSTOMER'),
  };
});
