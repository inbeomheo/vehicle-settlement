import { Suspense } from 'react';
import { PushSettings } from '@/components/push-settings';
import { DriverDashboard } from '@/client/driver-dashboard';
export default function Page() {
  return (
    <>
      <Suspense fallback={<p role="status">내 운행을 불러오는 중…</p>}>
        <DriverDashboard />
      </Suspense>
      <PushSettings />
    </>
  );
}
