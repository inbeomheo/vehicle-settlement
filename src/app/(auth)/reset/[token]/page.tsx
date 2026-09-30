import Link from 'next/link';
import { PasswordForm } from '@/components/password-form';
import { getDb } from '@/server/db/client';
import { getPasswordResetStatus, invalidResetMessage } from '@/server/services/password';
export const dynamic = 'force-dynamic';
export const metadata = { referrer: 'no-referrer' as const };
export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const reset = await getPasswordResetStatus(getDb(), token);
  return (
    <main className="flex min-h-dvh flex-col bg-ink md:items-center md:justify-center md:py-12">
      <div className="px-6 pt-10 pb-8 text-white md:w-full md:max-w-md md:px-0">
        <p className="inline-flex items-center gap-2 text-lg font-bold">
          <span aria-hidden="true" className="h-6 w-1.5 rounded-sm bg-signal" />
          차량 사용·정산
        </p>
      </div>
      <section className="min-w-0 flex-1 rounded-t-2xl bg-white px-6 pt-8 pb-10 md:w-full md:max-w-md md:flex-none md:rounded-2xl md:p-8">
        <h1 className="mb-5 text-2xl font-bold">비밀번호 재설정</h1>
        {reset.status === 'INVALID' ? (
          <>
            <p role="alert" className="leading-relaxed">
              {invalidResetMessage}
            </p>
            <Link
              href="/login"
              className="mt-4 inline-flex min-h-11 items-center font-semibold text-blue-800 underline"
            >
              로그인
            </Link>
          </>
        ) : (
          <>
            <dl className="mb-6 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-lg bg-slate-50 p-4 text-base">
              <dt>이름</dt>
              <dd className="break-all">{reset.name}</dd>
              <dt>아이디</dt>
              <dd className="break-all">{reset.login_id}</dd>
            </dl>
            <PasswordForm token={token} />
          </>
        )}
      </section>
    </main>
  );
}
