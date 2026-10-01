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

const setupSteps: { key: string; title: string; hint: string; href: string; optional?: boolean }[] = [
  {
    key: 'company',
    title: '회사 정보',
    hint: '명세서에 찍히는 회사 이름·사업자번호',
    href: '/m/master/company',
  },
  { key: 'projects', title: '현장', hint: '운행을 받을 현장(프로젝트)', href: '/m/master/projects' },
  { key: 'vehicles', title: '차량', hint: '차량번호·차종·톤수', href: '/m/master/vehicles' },
  {
    key: 'payees',
    title: '운송사·기사 사업자',
    hint: '돈을 받는 상호(개인 사업자 포함)',
    href: '/m/master/counterparties',
  },
  { key: 'drivers', title: '기사', hint: '기사 이름·연락처·기본 차량', href: '/m/master/drivers' },
  {
    key: 'affiliations',
    title: '기사 소속',
    hint: '기사가 어느 상호로 받는지',
    href: '/m/master/affiliations',
  },
  {
    key: 'rates',
    title: '계약·단가 (선택)',
    hint: '정해진 단가가 있으면 자동 계산, 운행마다 다르면 기사가 금액을 직접 넣습니다',
    href: '/m/master/rates',
    optional: true,
  },
  { key: 'people', title: '사람 초대', hint: '기사·현장 담당자·정산 담당자에게 초대 링크', href: '/m/users' },
];

/** 관리자가 처음 쓸 때: 운행을 받기 전에 등록할 것을 순서대로. 모두 끝나면 사라진다. */
function SetupChecklist() {
  const { data } = useRemote<Counts>('/api/setup-status');
  if (!data) return null;
  const required = setupSteps.filter((step) => !step.optional);
  const done = required.filter((step) => data[step.key] > 0).length;
  if (done === required.length && !data.unassigned_drivers) return null;
  return (
    <section aria-labelledby="setup-title" className="mb-8 rounded-lg border-2 border-signal bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="setup-title" className="text-xl font-bold">
          시작 준비
        </h2>
        <p className="num text-sm font-semibold text-slate-600">
          {done} / {required.length} 완료
        </p>
      </div>
      <p className="mt-1 text-[0.9375rem] text-slate-600">
        기사님이 운행을 보내기 전에 위에서부터 차례로 등록해 주세요.
      </p>
      {data.unassigned_drivers > 0 && (
        <Link
          href="/m/drivers"
          className="mt-4 flex min-h-14 items-center gap-3 rounded-lg border border-orange-200 bg-orange-50 p-3 font-semibold text-orange-800"
        >
          현장 배정이 없는 기사 {data.unassigned_drivers}명 → 기사관리에서 배정
        </Link>
      )}
      <ol className="mt-4 divide-y divide-slate-100">
        {setupSteps.map((step, index) => {
          const ok = data[step.key] > 0;
          return (
            <li key={step.key}>
              <Link href={step.href} className="flex min-h-14 items-center gap-3 py-2.5 hover:bg-slate-50">
                <span
                  aria-hidden="true"
                  className={`num flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${ok ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'}`}
                >
                  {ok ? '✓' : index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block font-semibold ${ok ? 'text-slate-500' : ''}`}>
                    {step.title}
                    <span className="sr-only">{ok ? ' 완료' : ' 아직 안 함'}</span>
                  </span>
                  <span className="block text-sm text-slate-600">{step.hint}</span>
                </span>
                <Chevron />
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
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
      <p className="text-[0.9375rem] text-slate-600">{todayLabel()}</p>
      <div className="mt-0.5 mb-5 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-[1.75rem] font-bold">처리할 일</h1>
        <Link href="/m/uses/new" className={secondaryClass}>
          대리 입력
        </Link>
      </div>
      {role === 'ADMIN' && <SetupChecklist />}
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
                      className={`num text-[2rem] leading-none font-bold ${data[item.key] ? item.tone : 'text-slate-300'}`}
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
