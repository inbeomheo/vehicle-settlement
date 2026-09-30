'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { acceptLogin } from '@/client/offline/store';

export function InviteForm({ token }: { token: string }) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [invalid, setInvalid] = useState(false);
  useEffect(() => setReady(true), []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/invites/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ login_id: form.get('login_id'), password: form.get('password') }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 404) setInvalid(true);
        else setError(result.error?.message ?? '요청을 처리하지 못했습니다.');
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
  if (invalid) return <p role="alert">이미 사용되었거나 만료된 초대입니다</p>;
  return (
    <form method="post" onSubmit={submit} className="space-y-5">
      <p className="text-sm text-slate-600">사용할 아이디와 비밀번호를 정하세요.</p>
      <label className="block text-sm font-semibold">
        아이디
        <input
          className="mt-1.5 block min-h-12 w-full rounded-lg border border-slate-300 px-3 text-base focus:border-blue-700 focus:outline-none focus:ring-3 focus:ring-blue-100"
          name="login_id"
          aria-describedby="login-id-hint"
          autoComplete="username"
          required
          maxLength={100}
        />
      </label>
      <p id="login-id-hint" className="-mt-3 text-sm text-slate-600">
        로그인할 때 쓰는 이름입니다. 영문·숫자로 정하면 편합니다.
      </p>
      <label className="block text-sm font-semibold">
        비밀번호
        <input
          className="mt-1.5 block min-h-12 w-full rounded-lg border border-slate-300 px-3 text-base focus:border-blue-700 focus:outline-none focus:ring-3 focus:ring-blue-100"
          name="password"
          aria-describedby="password-hint"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={72}
          required
        />
      </label>
      <p id="password-hint" className="-mt-3 text-sm text-slate-600">
        8자 이상으로 정하세요.
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        disabled={busy || !ready}
        className="min-h-12 w-full rounded-lg bg-signal font-bold text-ink shadow-[0_2px_0_#c99500] hover:bg-signal-strong active:translate-y-px active:shadow-none disabled:opacity-50"
      >
        {busy ? '처리 중…' : '가입하고 시작하기'}
      </button>
    </form>
  );
}
