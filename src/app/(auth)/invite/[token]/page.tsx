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
  // 로그인·비밀번호 재설정 화면과 같은 틀: 위쪽 어두운 띠 + 아래 흰 종이.
  return (
    <main className="flex min-h-dvh flex-col bg-ink md:items-center md:justify-center md:py-12">
      <div className="px-6 pt-[max(2.5rem,env(safe-area-inset-top))] pb-8 text-white md:w-full md:max-w-md md:px-0 md:pt-0">
        <p className="inline-flex items-center gap-2 text-lg font-bold">
          <span aria-hidden="true" className="h-6 w-1.5 rounded-sm bg-signal" />
          차량 사용·정산
        </p>
        {invite.status === 'VALID' && (
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-slate-300">
            {company?.name ?? '회사'}에서 {invite.name}님을 {roleLabels[invite.role]}(으)로 초대했습니다.
          </p>
        )}
      </div>
      <section className="flex-1 rounded-t-2xl bg-white px-6 pt-8 pb-10 md:w-full md:max-w-md md:flex-none md:rounded-2xl md:p-8">
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
