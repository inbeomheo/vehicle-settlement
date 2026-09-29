import { withRoute } from '@/server/http';
export const runtime = 'nodejs';
import { listInvites, createInvite } from '@/server/services/auth';
import { inviteSchema } from '@/server/services/schemas';
export const GET = withRoute(async ({ ctx }) => listInvites(ctx), { roles: ['ADMIN'] });
export const POST = withRoute(async ({ ctx, input }) => createInvite(ctx, input), {
  schema: inviteSchema,
  idempotent: true,
  roles: ['ADMIN'],
  redactStored(body) {
    const { data } = body as { data: Awaited<ReturnType<typeof createInvite>> };
    const { invite_url: _secret, ...invite } = data;
    void _secret;
    return {
      data: {
        ...invite,
        message:
          '이미 생성된 초대입니다. 원본 링크는 다시 표시할 수 없습니다. 초대 목록에서 취소 후 새 초대를 생성하세요.',
      },
    };
  },
});
