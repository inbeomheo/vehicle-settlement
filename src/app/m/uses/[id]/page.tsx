import { UseDetail } from '@/components/manager/use-detail';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <UseDetail id={(await params).id} />;
}
