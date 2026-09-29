import { guardPage } from '@/server/auth/page';
import { LogoutButton } from '@/components/logout-button';
export const dynamic = 'force-dynamic';
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await guardPage('driver');
  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <a href="/d" className="font-bold">
          차량 사용·정산
        </a>
        <div className="flex items-center gap-4">
          <span className="text-sm">{user.name}</span>
          <LogoutButton />
        </div>
      </header>
      <nav
        aria-label="주 메뉴"
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 border-t border-slate-200 bg-white px-2 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] text-center text-sm font-semibold"
      >
        <a className="rounded-lg px-3 py-3 hover:bg-blue-50 hover:text-blue-800" href="/d">
          내 운행
        </a>
        <a className="rounded-lg px-3 py-3 hover:bg-blue-50 hover:text-blue-800" href="/d/new">
          운행 등록
        </a>
        <a className="rounded-lg px-3 py-3 hover:bg-blue-50 hover:text-blue-800" href="/d/settlements">
          내 정산
        </a>
      </nav>
      <main className="mx-auto max-w-6xl px-4 pt-6 pb-28">{children}</main>
    </div>
  );
}
