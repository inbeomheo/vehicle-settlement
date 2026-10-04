import { Summary } from '@/components/manager/summary';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  return <Summary initial={await searchParams} />;
}
