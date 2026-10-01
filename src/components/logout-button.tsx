'use client';
import { stopBrowserPush } from '@/client/push-logout';
import { useState } from 'react';
import { activeUser, flushDrafts, isUnsent, listDrafts, markLoggedOut } from '@/client/offline/store';
export function LogoutButton({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div>
      <button
        disabled={busy}
        className={`min-h-11 whitespace-nowrap rounded-lg px-2.5 py-2 text-sm font-medium ${tone === 'dark' ? 'text-slate-200 hover:bg-white/10' : 'border border-slate-300 hover:bg-slate-50'}`}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await flushDrafts();
            const userId = activeUser();
            const count = userId
              ? (await listDrafts(userId)).filter((draft) => isUnsent(draft) || draft.inputError).length
              : 0;
            if (
              count &&
              !window.confirm(`전송되지 않은 ${count}건이 있습니다. 로그아웃하면 이 기기에서 볼 수 없습니다`)
            )
              return;
            await stopBrowserPush();
            markLoggedOut();
            try {
              await fetch('/api/auth/logout', { method: 'POST' });
            } catch {
              /* Online bootstrap retries server logout after local isolation. */
            }
            window.location.assign('/login');
          } catch {
            setError('기기 초안을 확인하지 못했습니다. 다시 시도해 주세요.');
          } finally {
            setBusy(false);
          }
        }}
      >
        로그아웃
      </button>
      {error && (
        <p role="alert" className={`text-sm ${tone === 'dark' ? 'text-red-300' : 'text-red-700'}`}>
          {error}
        </p>
      )}
    </div>
  );
}
