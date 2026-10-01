'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { acceptLogin } from '@/client/offline/store';
import { DriverInformationFields, emptyDriverInformation } from './driver-information-fields';
import { Field, Section, control, primary } from './use-form/fields';
import { requestJson } from './ui/request';

export function DriverJoinForm({
  token,
  individual = false,
  name = '',
  business,
}: {
  token: string;
  individual?: boolean;
  name?: string;
  business?: { name: string; masked_biz_no: string } | null;
}) {
  const [value, setValue] = useState({ ...emptyDriverInformation, name });
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef({ id: '', body: '' });
  useEffect(() => setReady(true), []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const { business_name: _name, biz_no: _biz, ...driverProfile } = value;
    void _name;
    void _biz;
    const body = {
      profile: business ? driverProfile : value,
      login_id: form.get('login_id'),
      password: form.get('password'),
    };
    // Keep the key on uncertain retries, but a deliberately edited form is a
    // different request. Credentials live only in memory, never localStorage.
    const serialized = JSON.stringify(body);
    if (request.current.body !== serialized) request.current = { id: crypto.randomUUID(), body: serialized };
    try {
      const { response, body: result } = await requestJson(
        individual
          ? `/api/invites/${encodeURIComponent(token)}/accept`
          : `/api/join/${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...body, client_request_id: request.current.id }),
        },
      );
      if (!response.ok)
        throw new Error(
          response.status === 404
            ? '만료되었거나 꺼진 가입 링크입니다. 관리자에게 새 링크를 요청하세요.'
            : result.error.message,
        );
      acceptLogin(result.data.id);
      window.location.assign('/d');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '가입하지 못했습니다. 다시 시도하세요.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-5">
      <DriverInformationFields joining business={business} value={value} onChange={setValue} />
      <Section title="로그인 정보">
        <div className="space-y-4">
          <Field label="아이디">
            <input className={control} name="login_id" autoComplete="username" required maxLength={100} />
          </Field>
          <Field label="비밀번호">
            <input
              className={control}
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={72}
            />
          </Field>
          <p className="text-sm text-slate-600">비밀번호는 8자 이상으로 정하세요.</p>
        </div>
      </Section>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}
      <button className={`${primary} w-full`} disabled={busy || !ready}>
        {busy ? '가입 중…' : '가입하고 시작하기'}
      </button>
    </form>
  );
}
