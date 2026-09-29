'use client';
import { useEffect, useState } from 'react';

const tabs = [
  { href: '/d', label: '내 운행', path: 'M3 10 12 3l9 7v11h-6v-7H9v7H3Z' },
  { href: '/d/new', label: '운행 등록', path: 'M12 5v14M5 12h14', primary: true },
  { href: '/d/settlements', label: '내 정산', path: 'M5 3h14v18l-3-2-4 2-4-2-3 2ZM9 8h6M9 12h6' },
];

function Icon({ path, size = 22 }: { path: string; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}

export function DriverNav() {
  const [pathname, setPathname] = useState('');
  useEffect(() => setPathname(location.pathname), []);
  // 입력 화면에서는 아래에 보내기 막대가 있으므로 가운데 버튼을 띄우지 않는다(막대를 가리지 않게).
  const onForm = pathname === '/d/new' || pathname.startsWith('/d/uses/');
  return (
    <nav
      aria-label="주 메뉴"
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 items-end border-t border-slate-200 bg-white px-2 pb-[max(0.25rem,env(safe-area-inset-bottom))] text-center text-sm"
    >
      {tabs.map((tab) => {
        const active =
          tab.href === '/d' ? pathname === '/d' || pathname.startsWith('/d/uses/') : pathname === tab.href;
        if (tab.primary) {
          // 가장 자주 하는 일: 탭 막대 위로 올라온 노란 원형 버튼(입력 화면에서는 막대 안에 둔다).
          return (
            <a
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className="flex min-h-14 flex-col items-center justify-end gap-1 px-2 pb-1.5 font-bold text-ink"
            >
              <span
                className={`${onForm ? 'mt-1 h-9 w-9 border-0 shadow-none' : '-mt-6 h-14 w-14 border-4 shadow-[0_2px_6px_rgb(0_0_0/0.18)]'} flex items-center justify-center rounded-full border-white bg-signal`}
              >
                <Icon path={tab.path} size={onForm ? 22 : 28} />
              </span>
              {tab.label}
            </a>
          );
        }
        return (
          <a
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`relative flex min-h-14 flex-col items-center justify-center gap-1 px-3 pt-2 pb-1.5 ${active ? 'font-bold text-ink' : 'font-medium text-slate-500'}`}
          >
            {active && (
              <span aria-hidden="true" className="absolute inset-x-6 top-0 h-1 rounded-b bg-signal" />
            )}
            <Icon path={tab.path} />
            {tab.label}
          </a>
        );
      })}
    </nav>
  );
}
