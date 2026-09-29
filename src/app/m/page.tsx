import { Dashboard } from '@/components/manager/dashboard';
import { pageUser } from '@/server/auth/page';
export default async function Page() {
  return <Dashboard role={(await pageUser()).role} />;
}
