import { withRoute } from '@/server/http';
import { pushConfig } from '@/server/push/config';
export const runtime = 'nodejs';
export const GET = withRoute(
  async () => {
    const config = pushConfig();
    return { enabled: !!config, publicKey: config?.publicKey ?? null };
  },
  { source: 'none' },
);
