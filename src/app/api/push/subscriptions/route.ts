import { withRoute } from '@/server/http';
import {
  deletePushSubscription,
  pushEndpointInput,
  pushSubscriptionInput,
  pushSubscriptionStatus,
  savePushSubscription,
} from '@/server/services/push';
export const runtime = 'nodejs';
export const POST = withRoute(
  async ({ ctx, input, request }) => savePushSubscription(ctx, input, request.headers.get('user-agent')),
  { schema: pushSubscriptionInput },
);
export const DELETE = withRoute(async ({ ctx, input }) => deletePushSubscription(ctx, input), {
  schema: pushEndpointInput,
});
export const GET = withRoute(async ({ ctx, input }) => pushSubscriptionStatus(ctx, input), {
  schema: pushEndpointInput,
  source: 'query',
});
