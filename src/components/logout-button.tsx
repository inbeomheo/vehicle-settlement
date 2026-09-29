'use client';
export function LogoutButton() {
  return (
    <button
      className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
      onClick={async () => {
        const r = await fetch('/api/auth/logout', { method: 'POST' });
        if (r.ok || r.status === 401) window.location.assign('/login');
      }}
    >
      로그아웃
    </button>
  );
}
