import { UseDetail } from '@/components/manager/use-detail';
import { guardPage } from '@/server/auth/page';
import { canSettle } from '@/server/auth/manager-access';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await guardPage('manager');
  return <UseDetail id={(await params).id} canSettle={canSettle(user.role)} />;
}
