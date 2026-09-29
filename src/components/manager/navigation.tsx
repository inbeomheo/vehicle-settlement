'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

export function ManagerNavigation({ items }: { items: { href: string; title: string }[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const section = pathname.startsWith('/m/uses/') && pathname !== '/m/uses/new' ? '/m/review' : pathname;
  const active = (href: string) =>
    href === '/m' ? section === href : section === href || section.startsWith(`${href}/`);
  const current = items.find((item) => active(item.href));
  return (
    <nav aria-label="주 메뉴" className="border-b border-slate-200 bg-white px-3 py-2">
      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-between rounded-lg px-3 text-sm font-semibold md:hidden"
        aria-label="메뉴"
        aria-expanded={open}
        aria-controls="manager-menu"
        onClick={() => setOpen(!open)}
      >
        <span>{current?.title ?? '사용 상세'}</span>
        <span aria-hidden="true">{open ? '✕ 닫기' : '☰ 메뉴'}</span>
      </button>
      <div id="manager-menu" className={`${open ? 'grid' : 'hidden'} grid-cols-2 gap-1 md:flex md:flex-wrap`}>
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active(item.href) ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center rounded-lg px-3 py-3 text-sm hover:bg-blue-50 hover:text-blue-800 ${active(item.href) ? 'bg-blue-50 font-semibold text-blue-800' : ''}`}
            onClick={() => setOpen(false)}
          >
            {item.title}
          </Link>
        ))}
      </div>
    </nav>
  );
}
