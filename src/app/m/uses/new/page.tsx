import { UseFormPage } from '@/components/use-form/use-form';
import { projectFromQuery, type ManagerSearchParams } from '../../project-query';
export default async function Page({ searchParams }: { searchParams: Promise<ManagerSearchParams> }) {
  await projectFromQuery(await searchParams, '/m/uses/new', true);
  return <UseFormPage mode="manager" />;
}
