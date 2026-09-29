'use client';
import { useEffect, useState } from 'react';

const tabs = [
  { href: '/d', label: '내 운행', path: 'M3 10 12 3l9 7v11h-6v-7H9v7H3Z' },
  { href: '/d/new', label: '운행 등록', path: 'M12 5v14M5 12h14' },
  { href: '/d/settlements', label: '내 정산', path: 'M5 3h14v18l-3-2-4 2-4-2-3 2ZM9 8h6M9 12h6' },
];
export function DriverNav() {
  const [pathname, setPathname] = useState('');
  useEffect(() => setPathname(location.pathname), []);
  return (
    <nav
      aria-label="주 메뉴"
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 border-t border-slate-200 bg-white px-2 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] text-center text-sm"
    >
      {tabs.map((tab) => {
        const active =
          tab.href === '/d' ? pathname === '/d' || pathname.startsWith('/d/uses/') : pathname === tab.href;
        return (
          <a
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg px-3 py-2 ${active ? 'bg-blue-50 font-bold text-blue-800' : 'font-medium text-slate-500 hover:bg-slate-50'}`}
          >
            <svg
              aria-hidden="true"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d={tab.path} />
            </svg>
            {tab.label}
          </a>
        );
      })}
    </nav>
  );
}
