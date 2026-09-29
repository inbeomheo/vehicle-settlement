'use client';
import { acceptLogin } from '@/client/offline/store';
import { useEffect, useState, type FormEvent } from 'react';
export function AuthForm({ token }: { token?: string }) {
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(
        token ? `/api/invites/${encodeURIComponent(token)}/accept` : '/api/auth/login',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ login_id: form.get('login_id'), password: form.get('password') }),
        },
      );
      const result = await response.json();
      if (!response.ok) {
        setError(result.error?.message ?? '요청을 처리하지 못했습니다.');
        return;
      }
      acceptLogin(result.data.id);
      window.location.assign(result.data.role === 'DRIVER' ? '/d' : '/m');
    } catch {
      setError('연결 상태를 확인한 후 다시 시도하세요.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="flex min-h-dvh flex-col bg-ink md:items-center md:justify-center md:py-12">
      <div className="px-6 pt-[max(2.5rem,env(safe-area-inset-top))] pb-8 text-white md:w-full md:max-w-md md:px-0 md:pt-0">
        <p className="inline-flex items-center gap-2 text-lg font-bold">
          <span aria-hidden="true" className="h-6 w-1.5 rounded-sm bg-signal" />
          차량 사용·정산
        </p>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-slate-300">
          운행 등록부터 검수·월 정산·지급까지 한곳에서.
        </p>
      </div>
      <section className="flex-1 rounded-t-2xl bg-white px-6 pt-8 pb-10 md:w-full md:max-w-md md:flex-none md:rounded-2xl md:p-8">
        <h1 className="mb-1 text-2xl font-bold">{token ? '초대 수락' : '로그인'}</h1>
        <p className="mb-7 text-sm text-slate-600">
          {token ? '사용할 아이디와 비밀번호를 정하세요.' : '담당자에게 받은 아이디로 로그인하세요.'}
        </p>
        <form method="post" onSubmit={submit} className="space-y-5">
          <label className="block text-sm font-semibold">
            아이디
            <input
              className="mt-1.5 block min-h-12 w-full rounded-lg border border-slate-300 px-3 text-base focus:border-blue-700 focus:outline-none focus:ring-3 focus:ring-blue-100"
              name="login_id"
              autoComplete="username"
              required
              maxLength={100}
            />
          </label>
          <label className="block text-sm font-semibold">
            비밀번호
            <input
              className="mt-1.5 block min-h-12 w-full rounded-lg border border-slate-300 px-3 text-base focus:border-blue-700 focus:outline-none focus:ring-3 focus:ring-blue-100"
              name="password"
              type="password"
              autoComplete={token ? 'new-password' : 'current-password'}
              minLength={token ? 8 : 1}
              maxLength={72}
              required
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <button
            disabled={busy || !ready}
            className="min-h-12 w-full rounded-lg bg-signal font-bold text-ink shadow-[0_2px_0_#c99500] hover:bg-signal-strong active:translate-y-px active:shadow-none disabled:opacity-50"
          >
            {busy ? '처리 중…' : token ? '가입하고 시작하기' : '로그인'}
          </button>
        </form>
      </section>
    </main>
  );
}
