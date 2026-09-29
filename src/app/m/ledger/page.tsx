import { Ledger } from '@/components/manager/ledger';
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  return <Ledger initial={await searchParams} />;
}
