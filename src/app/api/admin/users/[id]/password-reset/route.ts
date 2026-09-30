import { withRoute } from '@/server/http';
import { createPasswordReset } from '@/server/services/password';
export const runtime = 'nodejs';
export const POST = withRoute(({ ctx, params }) => createPasswordReset(ctx, params.id), {
  roles: ['ADMIN'],
  idempotent: true,
  source: 'none',
  redactStored(body) {
    const { data } = body as { data: Awaited<ReturnType<typeof createPasswordReset>> };
    const { reset_url: _secret, ...reset } = data;
    void _secret;
    return { data: { ...reset, message: '이미 만든 링크입니다. 링크를 잃어버렸다면 새 링크를 만드세요.' } };
  },
});
