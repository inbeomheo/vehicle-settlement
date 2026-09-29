import Link from 'next/link';
export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-6 py-20">
      <h1 className="mb-4 text-2xl font-bold">페이지를 찾을 수 없습니다</h1>
      <p className="mb-8 text-slate-600">주소를 확인하거나 시작 화면으로 이동하세요.</p>
      <Link href="/" className="text-blue-700 underline">
        시작 화면으로 이동
      </Link>
    </main>
  );
}
