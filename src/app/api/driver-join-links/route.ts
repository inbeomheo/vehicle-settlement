import { withRoute } from '@/server/http';
import { createJoinLink, listJoinLinks } from '@/server/services/driver-join';
export const GET = withRoute(({ ctx }) => listJoinLinks(ctx), { roles: ['ADMIN'] });
export const POST = withRoute(({ ctx, input }) => createJoinLink(ctx, input), {
  roles: ['ADMIN'],
  idempotent: true,
  redactStored(body) {
    const { data } = body as { data: Awaited<ReturnType<typeof createJoinLink>> };
    const { join_url: _secret, ...rest } = data;
    void _secret;
    return {
      data: {
        ...rest,
        message: '이미 생성된 링크입니다. 원본 링크는 다시 표시할 수 없습니다. 새 링크를 만드세요.',
      },
    };
  },
});
