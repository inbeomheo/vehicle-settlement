import { ReviewInbox } from '@/components/manager/ledger';
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  return <ReviewInbox initialTab={(await searchParams).tab} />;
}
