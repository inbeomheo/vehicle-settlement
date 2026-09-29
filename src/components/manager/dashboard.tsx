'use client';
import Link from 'next/link';
import { Empty, Notice, money, secondaryClass, signalClass, useRemote } from './common';
import { canSettle } from '@/server/auth/manager-access';
import type { Context } from '@/server/context';

type Counts = Record<string, number>;

function todayLabel() {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date());
}

function Chevron() {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-slate-400"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

/** 대시보드는 "지금 처리할 일"만 보여준다. 숫자를 누르면 해당 목록으로 간다. */
export function Dashboard({ role }: { role: Context['user']['role'] }) {
  const { data, error, loading, refresh } = useRemote<Counts>('/api/dashboard');
  const settle = canSettle(role);
  const todo = [
    { title: '검수 대기', key: 'review_pending', href: '/m/review?tab=SUBMITTED', tone: 'text-blue-700' },
    { title: '보완 대기', key: 'fix_pending', href: '/m/review?tab=NEEDS_FIX', tone: 'text-orange-600' },
    { title: '증빙 누락', key: 'evidence_missing', href: '/m/review?tab=MISSING', tone: 'text-ink' },
  ];
  const nothingToDo = data && todo.every((item) => !data[item.key]);
  return (
    <div className="max-w-3xl">
      <p className="text-[15px] text-slate-600">{todayLabel()}</p>
      <div className="mt-0.5 mb-5 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-[28px] font-bold">처리할 일</h1>
        <Link href="/m/uses/new" className={secondaryClass}>
          대리 입력
        </Link>
      </div>
      <Notice error={error} onRetry={error ? refresh : undefined} />
      {loading && !data ? (
        <Empty loading />
      ) : (
        data && (
          <>
            <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
              {todo.map((item) => (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    className="flex min-h-18 items-center gap-4 px-5 py-4 hover:bg-slate-50"
                  >
                    <span className="flex-1 text-lg font-semibold">{item.title}</span>
                    <span
                      className={`num text-[32px] leading-none font-bold ${data[item.key] ? item.tone : 'text-slate-300'}`}
                    >
                      {data[item.key]}
                    </span>
                    <span className="-ml-2 self-end pb-1 text-sm text-slate-500">건</span>
                    <Chevron />
                  </Link>
                </li>
              ))}
            </ul>
            {nothingToDo ? (
              <p className="mt-3 rounded-lg bg-emerald-50 px-5 py-4 font-semibold text-emerald-800">
                검수할 운행이 없습니다. 모두 처리했습니다.
              </p>
            ) : (
              <Link href="/m/review" className={`${signalClass} mt-3 min-h-14 w-full text-lg`}>
                검수함 열기
              </Link>
            )}

            <h2 className="mt-9 mb-3 text-xl font-bold">정산 현황</h2>
            <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
              <li>
                <Link
                  href="/m/ledger?unsettled_approved=true"
                  className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50"
                >
                  <span className="flex-1">
                    <span className="block font-semibold">정산 전 승인 금액</span>
                    <span className="text-sm text-slate-600">승인했지만 아직 명세에 넣지 않은 금액</span>
                  </span>
                  <span className="num text-xl font-bold">{money(data.unsettled_approved_amount)}</span>
                  <Chevron />
                </Link>
              </li>
              <li>
                {settle ? (
                  <Link
                    href="/m/payments?state=UNPAID"
                    className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50"
                  >
                    <span className="flex-1">
                      <span className="block font-semibold">지급할 금액</span>
                      <span className="text-sm text-slate-600">
                        확정 명세 {data.unpaid_count}건 · 부가세 포함
                      </span>
                    </span>
                    <span className="num text-xl font-bold">{money(data.unpaid_amount)}</span>
                    <Chevron />
                  </Link>
                ) : (
                  <div className="flex items-center gap-4 px-5 py-4">
                    <span className="flex-1">
                      <span className="block font-semibold">지급할 금액</span>
                      <span className="text-sm text-slate-600">정산 담당자 확인 후 지급됩니다</span>
                    </span>
                    <span className="num text-xl font-bold">{money(data.unpaid_amount)}</span>
                  </div>
                )}
              </li>
            </ul>
          </>
        )
      )}
    </div>
  );
}
