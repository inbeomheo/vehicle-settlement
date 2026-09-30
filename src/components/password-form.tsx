'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { Field, inputClass, panelClass, signalClass } from './manager/common';
import { control, primary } from './use-form/fields';
import { useBusy } from './ui/use-busy';
import { requestJson } from './ui/request';

export function PasswordForm({ token, driver = false }: { token?: string; driver?: boolean }) {
  const { busy, begin, end } = useBusy();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => setReady(true), []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const data = new FormData(element);
    setError('');
    setSuccess(false);
    if (data.get('password') !== data.get('password_confirmation')) {
      setError('새 비밀번호가 서로 다릅니다.');
      return;
    }
    if (!begin()) return;
    try {
      const { response, body } = await requestJson(
        token ? `/api/password-resets/${encodeURIComponent(token)}` : '/api/auth/password',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(Object.fromEntries(data)),
        },
      );
      if (!response.ok) {
        setError(body.error.message);
        if (token && response.status === 404) setInvalid(true);
        return;
      }
      element.reset();
      setSuccess(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '연결 상태를 확인한 후 다시 시도하세요.');
    } finally {
      end();
    }
  }
  const inputStyle = driver ? control : inputClass;
  if (token && (success || invalid))
    return (
      <div>
        <p role={success ? 'status' : 'alert'} className="leading-relaxed">
          {success ? '비밀번호를 바꿨습니다. 새 비밀번호로 로그인하세요.' : error}
        </p>
        <Link href="/login" className={`${signalClass} mt-5 w-full`}>
          로그인
        </Link>
      </div>
    );
  return (
    <form method="post" onSubmit={submit} className="space-y-5">
      <p id="password-help" className="text-sm leading-relaxed text-slate-600">
        새 비밀번호는 8자 이상으로 정하세요.
      </p>
      {!token && (
        <Field title="현재 비밀번호">
          <input
            className={inputStyle}
            name="current_password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={72}
          />
        </Field>
      )}
      <Field title="새 비밀번호">
        <input
          className={inputStyle}
          name="password"
          type="password"
          autoComplete="new-password"
          aria-describedby="password-help"
          required
          minLength={8}
          maxLength={72}
        />
      </Field>
      <Field title="새 비밀번호 확인">
        <input
          className={inputStyle}
          name="password_confirmation"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={72}
        />
      </Field>
      {error && (
        <p role="alert" className="text-base text-red-700">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="text-base text-emerald-800">
          비밀번호를 바꿨습니다
        </p>
      )}
      <button disabled={busy || !ready} className={`${driver ? primary : signalClass} w-full`}>
        {busy ? '바꾸는 중…' : '비밀번호 바꾸기'}
      </button>
    </form>
  );
}

export function AccountPage({ driver = false }: { driver?: boolean }) {
  return (
    <section className={`${panelClass} mx-auto max-w-lg`}>
      <h1 className="mb-2 text-2xl font-bold">비밀번호 변경</h1>
      <p className="mb-6 text-base text-slate-600">
        비밀번호를 바꾸면 다른 기기에서는 다시 로그인해야 합니다.
      </p>
      <PasswordForm driver={driver} />
    </section>
  );
}
