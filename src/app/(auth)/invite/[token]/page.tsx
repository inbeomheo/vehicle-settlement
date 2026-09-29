import Link from 'next/link';
import { getDb } from '@/server/db/client';
import { companySettings } from '@/server/db/schema';
import { getInviteStatus } from '@/server/services/auth';
import { InviteForm } from './invite-form';

export const dynamic = 'force-dynamic';

const roleLabels = {
  ADMIN: '관리자',
  SITE_MANAGER: '현장 담당자',
  SETTLEMENT_MANAGER: '정산 담당자',
  DRIVER: '기사',
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = getDb();
  const invite = await getInviteStatus(db, token);
  const [company] =
    invite.status === 'VALID'
      ? await db.select({ name: companySettings.name }).from(companySettings).limit(1)
      : [];
  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center px-4 py-10">
      <section className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="mb-2 text-sm font-semibold text-blue-700">차량 사용·정산</p>
        <h1 className="mb-4 text-2xl font-bold">초대 수락</h1>
        {invite.status === 'INVALID' ? (
          <>
            <p role="alert" className="text-slate-700">
              이미 사용되었거나 만료된 초대입니다
            </p>
            <p className="mt-2 text-sm text-slate-600">관리자에게 새 초대 링크를 요청하세요.</p>
            <Link
              href="/login"
              className="mt-4 inline-flex min-h-11 items-center font-semibold text-blue-800 underline"
            >
              로그인으로 이동
            </Link>
          </>
        ) : (
          <>
            <dl className="mb-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg bg-slate-50 p-4 text-sm">
              <dt className="text-slate-500">회사</dt>
              <dd>{company?.name ?? '차량 사용·정산'}</dd>
              <dt className="text-slate-500">초대된 이름</dt>
              <dd>{invite.name}</dd>
              <dt className="text-slate-500">역할</dt>
              <dd>{roleLabels[invite.role]}</dd>
            </dl>
            <InviteForm token={token} />
          </>
        )}
      </section>
    </main>
  );
}
