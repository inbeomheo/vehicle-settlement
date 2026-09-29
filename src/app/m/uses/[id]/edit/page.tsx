import { UseFormPage } from '@/components/use-form/use-form';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <UseFormPage mode="manager" useId={id} />;
}
