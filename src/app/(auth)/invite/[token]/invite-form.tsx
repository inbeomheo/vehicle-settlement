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
      <p className="text-sm text-slate-600">사용할 아이디와 비밀번호를 등록하세요.</p>
      <label className="block">
        아이디
        <input
          className="mt-2 block min-h-12 w-full rounded-lg border border-slate-300 px-3 text-base"
          name="login_id"
          autoComplete="username"
          required
          maxLength={100}
        />
      </label>
      <label className="block">
        비밀번호
        <input
          className="mt-2 block min-h-12 w-full rounded-lg border border-slate-300 px-3 text-base"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
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
        className="min-h-12 w-full rounded-lg bg-blue-700 font-bold text-white disabled:opacity-50"
      >
        {busy ? '처리 중…' : '가입하고 시작하기'}
      </button>
    </form>
  );
}
