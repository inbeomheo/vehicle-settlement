import { PushSettings } from '@/components/push-settings';
import { DriverDashboard } from '@/client/driver-dashboard';
export default function Page() {
  return (
    <>
      <DriverDashboard />
      <PushSettings />
    </>
  );
}
