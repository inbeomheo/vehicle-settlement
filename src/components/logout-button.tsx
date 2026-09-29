'use client';
import { markLoggedOut } from '@/client/offline/store';
export function LogoutButton() {
  return (
    <button
      className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
      onClick={async () => {
        markLoggedOut();
        try {
          await fetch('/api/auth/logout', { method: 'POST' });
        } catch {
          // Local isolation remains in effect; online bootstrap retries logout.
        } finally {
          window.location.assign('/login');
        }
      }}
    >
      로그아웃
    </button>
  );
}
