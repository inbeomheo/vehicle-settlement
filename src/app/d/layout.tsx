import Link from 'next/link';
import { guardPage } from '@/server/auth/page';
import { LogoutButton } from '@/components/logout-button';
export const dynamic = 'force-dynamic';
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await guardPage('driver');
  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <Link href="/d" className="font-bold">
          차량 사용·정산
        </Link>
        <div className="flex items-center gap-4">
          <span className="text-sm">{user.name}</span>
          <LogoutButton />
        </div>
      </header>
      <nav aria-label="주 메뉴" className="flex flex-wrap gap-1 border-b border-slate-200 bg-white px-3 py-2">
        <Link className="rounded-lg px-3 py-3 hover:bg-blue-50 hover:text-blue-800" href="/d">
          내 운행
        </Link>
        <Link className="rounded-lg px-3 py-3 hover:bg-blue-50 hover:text-blue-800" href="/d/new">
          운행 등록
        </Link>
        <Link className="rounded-lg px-3 py-3 hover:bg-blue-50 hover:text-blue-800" href="/d/settlements">
          내 정산
        </Link>
      </nav>
      <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
    </div>
  );
}
