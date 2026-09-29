import { guardPage } from '@/server/auth/page';
import { DriverNav } from '@/client/driver-nav';
import { LogoutButton } from '@/components/logout-button';
export const dynamic = 'force-dynamic';
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await guardPage('driver');
  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-4">
        <a href="/d" className="inline-flex min-h-11 min-w-11 items-center font-bold">
          차량 사용·정산
        </a>
        <div className="flex items-center gap-2">
          <span className="text-sm">{user.name}</span>
          <LogoutButton />
        </div>
      </header>
      <DriverNav />
      <main className="mx-auto max-w-6xl px-4 pt-6 pb-28">{children}</main>
    </div>
  );
}
