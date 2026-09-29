import { guardPage } from '@/server/auth/page';
import { canAccessManagerPage, managerMenu } from '@/server/auth/manager-access';
import { ManagerNavigation } from '@/components/manager/navigation';
import './manager.css';
export const dynamic = 'force-dynamic';

const roleLabels: Record<string, string> = {
  ADMIN: '관리자',
  SITE_MANAGER: '현장 담당자',
  SETTLEMENT_MANAGER: '정산 담당자',
};

export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await guardPage('manager');
  return (
    <div className="manager-shell min-h-dvh">
      <ManagerNavigation
        items={managerMenu.filter((item) => canAccessManagerPage(user.role, item.href))}
        userName={user.name}
        roleLabel={roleLabels[user.role] ?? user.role}
      />
      <main className="w-full px-4 py-5 md:ml-60 md:w-[calc(100%-15rem)] md:px-8 md:py-8">
        <div className="mx-auto max-w-[1400px]">{children}</div>
      </main>
    </div>
  );
}
