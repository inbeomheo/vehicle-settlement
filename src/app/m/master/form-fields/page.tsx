import { FormFieldSettings } from '@/components/manager/form-fields';
import { projectFromQuery, type ManagerSearchParams } from '../../project-query';
export default async function Page({ searchParams }: { searchParams: Promise<ManagerSearchParams> }) {
  const project = await projectFromQuery(await searchParams, '/m/master/form-fields');
  return <FormFieldSettings initialProject={project} />;
}
