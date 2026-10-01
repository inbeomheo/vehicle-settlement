import { Suspense } from 'react';
import { Approvals } from '@/components/manager/approvals';
export default function Page() {
  return (
    <Suspense fallback={<p role="status">운행 결재를 불러오는 중…</p>}>
      <Approvals />
    </Suspense>
  );
}
