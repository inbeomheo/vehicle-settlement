import { guardPage } from '@/server/auth/page';
import { DriverNav } from '@/client/driver-nav';
import { LogoutButton } from '@/components/logout-button';
export const dynamic = 'force-dynamic';
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await guardPage('driver');
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 flex items-center justify-between bg-ink px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 text-white">
        <a href="/d" className="inline-flex min-h-11 min-w-11 items-center gap-2 font-bold">
          <span aria-hidden="true" className="h-5 w-1.5 rounded-sm bg-signal" />
          차량 사용·정산
        </a>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-300">{user.name}</span>
          <LogoutButton tone="dark" />
        </div>
      </header>
      <DriverNav />
      <main className="mx-auto max-w-2xl px-4 pt-5 pb-32">{children}</main>
    </div>
  );
}
