import Link from 'next/link';
import { getDb } from '@/server/db/client';
import { getJoinLinkStatus } from '@/server/services/driver-join';
import { DriverJoinForm } from '@/components/driver-join-form';
import { TextSizeControl, TextSizeScript } from '@/components/ui/text-size';
export const dynamic = 'force-dynamic';
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await getJoinLinkStatus(getDb(), token);
  return (
    <main className="min-h-dvh bg-slate-100 p-4 sm:py-8">
      <TextSizeScript fallback="normal" />
      <div className="mx-auto max-w-2xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-bold">차량 사용·정산</p>
          <div className="[&_button]:min-h-11 [&_button]:min-w-11">
            <TextSizeControl fallback="normal" />
          </div>
        </div>
        <h1 className="text-2xl font-bold">기사 가입</h1>
        {link ? (
          <>
            <p className="break-words text-slate-700">담당 현장: {link.project_names.join(', ')}</p>
            <DriverJoinForm token={token} business={link.business} />
          </>
        ) : (
          <>
            <p role="alert">만료되었거나 꺼진 가입 링크입니다. 관리자에게 새 링크를 요청하세요.</p>
            <Link className="inline-flex min-h-11 items-center underline" href="/login">
              로그인으로 이동
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
