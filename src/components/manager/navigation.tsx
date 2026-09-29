'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LogoutButton } from '@/components/logout-button';
import { TextSizeControl } from '@/components/ui/text-size';

type Item = { href: string; title: string };

const icons: Record<string, string> = {
  '/m': 'M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 4v4h6V4z',
  '/m/review': 'M9 11l3 3 8-8M20 12v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h11',
  '/m/ledger':
    'M3 7h13v10H3zM16 10h3l2 3v4h-5M7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4M17 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4',
  '/m/uses/new': 'M12 5v14M5 12h14',
  '/m/statements': 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5',
  '/m/payments': 'M3 7h18v10H3zM3 11h18M7 15h3',
  '/m/import': 'M12 3v12M7 10l5 5 5-5M4 19h16',
  '/m/master': 'M4 6h16M4 12h16M4 18h10',
  '/m/users':
    'M16 19v-1a4 4 0 0 0-8 0v1M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19 19v-1a3 3 0 0 0-2-2.8M17 5.2a3 3 0 0 1 0 5.6',
  '/m/audit': 'M12 8v4l3 2M3 12a9 9 0 1 0 3-6.7M3 4v4h4',
};

function MenuIcon({ href }: { href: string }) {
  return (
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
      className="shrink-0 opacity-80"
    >
      <path d={icons[href] ?? icons['/m/master']} />
    </svg>
  );
}

/** 검수 대기 건수 — 메뉴 배지로 보여 준다. */
function useReviewCount() {
  const [count, setCount] = useState<number>();
  const pathname = usePathname();
  useEffect(() => {
    let alive = true;
    fetch('/api/dashboard', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => alive && setCount(body?.data?.review_pending))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pathname]);
  return count;
}

function useActive(items: Item[]) {
  const pathname = usePathname();
  const section = pathname.startsWith('/m/uses/') && pathname !== '/m/uses/new' ? '/m/review' : pathname;
  const active = (href: string) =>
    href === '/m' ? section === href : section === href || section.startsWith(`${href}/`);
  return { active, current: items.find((item) => active(item.href)), pathname };
}

function Brand() {
  return (
    <Link href="/m" className="inline-flex min-h-11 items-center gap-2 font-bold whitespace-nowrap">
      <span aria-hidden="true" className="h-5 w-1.5 rounded-sm bg-signal" />
      차량 사용·정산
    </Link>
  );
}

function MenuLinks({ items, onNavigate }: { items: Item[]; onNavigate?: () => void }) {
  const { active } = useActive(items);
  const reviewCount = useReviewCount();
  return (
    <ul className="grid gap-0.5">
      {items.map((item) => {
        const on = active(item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={on ? 'page' : undefined}
              onClick={onNavigate}
              className={`relative flex min-h-11 items-center gap-3 rounded-md px-3 text-[0.9375rem] ${on ? 'bg-white/10 font-semibold text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}
            >
              {on && (
                <span aria-hidden="true" className="absolute inset-y-2 left-0 w-1 rounded-r bg-signal" />
              )}
              <MenuIcon href={item.href} />
              <span className="flex-1">{item.title}</span>
              {item.href === '/m/review' && !!reviewCount && (
                <span className="num rounded-full bg-signal px-2 py-0.5 text-xs font-bold text-ink">
                  {reviewCount}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** PC: 왼쪽 고정 메뉴. 휴대폰: 상단 막대 + 펼치는 메뉴. */
export function ManagerNavigation({
  items,
  userName,
  roleLabel,
}: {
  items: Item[];
  userName: string;
  roleLabel: string;
}) {
  const { current, pathname } = useActive(items);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-ink px-3 py-4 text-white md:flex">
        <div className="px-2 pb-6">
          <Brand />
        </div>
        <nav aria-label="주 메뉴" className="flex-1 overflow-y-auto">
          <MenuLinks items={items} />
        </nav>
        <div className="mt-4 border-t border-white/10 px-2 pt-4">
          <p className="mb-1.5 text-sm text-slate-300">글자 크기</p>
          <div className="mb-4">
            <TextSizeControl fallback="normal" tone="dark" />
          </div>
          <p className="font-semibold">{userName}</p>
          <p className="mb-2 text-sm text-slate-400">{roleLabel}</p>
          <div className="flex flex-wrap items-center gap-1">
            <a
              href="/manual"
              target="_blank"
              className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold text-slate-200 hover:bg-white/10"
            >
              사용 설명서
            </a>
            <LogoutButton tone="dark" />
          </div>
        </div>
      </aside>

      <header className="sticky top-0 z-30 bg-ink text-white md:hidden">
        <div className="flex items-center justify-between gap-2 px-3 pt-[max(0.25rem,env(safe-area-inset-top))]">
          <Brand />
          <button
            type="button"
            aria-label="메뉴"
            aria-expanded={open}
            aria-controls="manager-menu"
            onClick={() => setOpen(!open)}
            className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold hover:bg-white/10"
          >
            <span className="max-w-32 truncate text-slate-200">{current?.title ?? '사용 상세'}</span>
            <svg
              aria-hidden="true"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
        {open && (
          <nav id="manager-menu" aria-label="주 메뉴" className="border-t border-white/10 px-3 pt-2 pb-3">
            <MenuLinks items={items} onNavigate={() => setOpen(false)} />
            <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3">
              <TextSizeControl fallback="normal" tone="dark" />
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3">
              <span className="text-sm text-slate-300">
                {userName} · {roleLabel}
              </span>
              <span className="flex items-center gap-1">
                <a
                  href="/manual"
                  target="_blank"
                  className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold text-slate-200 hover:bg-white/10"
                >
                  사용 설명서
                </a>
                <LogoutButton tone="dark" />
              </span>
            </div>
          </nav>
        )}
      </header>
    </>
  );
}
