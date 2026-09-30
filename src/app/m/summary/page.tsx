import { Summary } from '@/components/manager/summary';
import { todaySeoul } from '@/server/context';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  return <Summary initial={await searchParams} today={todaySeoul()} />;
}
