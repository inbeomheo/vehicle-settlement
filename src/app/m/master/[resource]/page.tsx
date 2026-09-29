import { Master } from '@/components/manager/master';
export default async function Page({ params }: { params: Promise<{ resource: string }> }) {
  return <Master resource={(await params).resource} />;
}
