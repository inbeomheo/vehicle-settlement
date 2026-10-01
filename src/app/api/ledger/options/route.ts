import { withRoute } from '@/server/http';
import { getLookups } from '@/server/services/lookups';
export const GET = withRoute(
  async ({ ctx }) => {
    const { projects, drivers, vehicles, counterparties } = await getLookups(ctx);
    return {
      projects,
      drivers,
      vehicles,
      counterparties: counterparties.filter((party) => party.kind !== 'CUSTOMER'),
    };
  },
  { roles: ['ADMIN', 'SITE_MANAGER', 'SETTLEMENT_MANAGER'] },
);
