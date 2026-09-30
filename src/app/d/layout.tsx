import { guardPage } from '@/server/auth/page';
import { DriverNav } from '@/client/driver-nav';
import { LogoutButton } from '@/components/logout-button';
import { TextSizeControl, TextSizeScript } from '@/components/ui/text-size';
export const dynamic = 'force-dynamic';
export default async function Layout({ children }: { children: React.ReactNode }) {
  await guardPage('driver');
  return (
    <div className="min-h-dvh">
      <TextSizeScript fallback="normal" />
      <header className="sticky top-0 z-20 flex items-center justify-between gap-2 bg-ink px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 text-white [font-size:15px]">
        <a
          href="/d"
          aria-label="차량 사용·정산"
          className="inline-flex min-h-11 min-w-11 items-center gap-2 font-bold whitespace-nowrap"
        >
          <span aria-hidden="true" className="h-5 w-1.5 rounded-sm bg-signal" />
          <span className="hidden min-[400px]:inline">차량 사용·정산</span>
        </a>
        <div className="flex shrink-0 items-center gap-1">
          <TextSizeControl fallback="normal" tone="dark" />
          <LogoutButton tone="dark" />
        </div>
      </header>
      <DriverNav />
      <main className="mx-auto max-w-2xl px-4 pt-5 pb-32">{children}</main>
    </div>
  );
}
