import Link from 'next/link';
import { guardPage } from '@/server/auth/page';
import { LogoutButton } from '@/components/logout-button';
import { canAccessManagerPage, managerMenu } from '@/server/auth/manager-access';
import { ManagerNavigation } from '@/components/manager/navigation';
import './manager.css';
export const dynamic = 'force-dynamic';
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await guardPage('manager');
  return (
    <div className="manager-shell min-h-dvh">
      <header className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2 md:px-6 md:py-4">
        <Link href="/m" className="inline-flex min-h-11 items-center whitespace-nowrap font-bold">
          차량 사용·정산
        </Link>
        <div className="flex min-w-0 items-center gap-2 md:gap-4">
          <span className="max-w-24 truncate text-sm md:max-w-none">{user.name}</span>
          <LogoutButton />
        </div>
      </header>
      <ManagerNavigation items={managerMenu.filter((item) => canAccessManagerPage(user.role, item.href))} />
      <main className="mx-auto w-full max-w-[1600px] px-4 py-6 md:px-6 md:py-10">{children}</main>
    </div>
  );
}
