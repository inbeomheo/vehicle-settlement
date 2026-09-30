'use client';
import type { driverSettlements } from '@/server/services/statements-driver';
import { money } from '../../m/statements/ui';

type Data = Awaited<ReturnType<typeof driverSettlements>>;
type Use = Data['uses'][number];
const reviews: Record<Use['review_status'], string> = {
  DRAFT: '아직 안 보냄',
  SUBMITTED: '확인 기다림',
  APPROVED: '승인됨',
  NEEDS_FIX: '고쳐서 다시 보내기',
};
function dateLabel(date: string) {
  const value = new Date(`${date}T00:00:00+09:00`);
  return `${Number(date.slice(5, 7))}월 ${Number(date.slice(8))}일 (${new Intl.DateTimeFormat('ko-KR', { weekday: 'short', timeZone: 'Asia/Seoul' }).format(value)})`;
}
/** 한 운행의 금액: 승인되면 굵게, 검수 전이면 회색 금액 위에 작은 "검수 전". */
function Amount({ use }: { use: Use }) {
  if (use.operation_status === 'CANCELED')
    return <span className="text-sm font-semibold text-slate-500">취소 · 합계 제외</span>;
  const approved = use.review_status === 'APPROVED' || use.approved_supply !== 0;
  return (
    <span className="flex flex-col items-end">
      <span className="sr-only">인정 공급가 </span>
      {approved ? (
        <span className="num text-lg font-bold whitespace-nowrap">{money(use.approved_supply)}</span>
      ) : (
        <>
          <span className="text-xs font-semibold text-slate-500">검수 전</span>
          <span className="num text-lg font-bold whitespace-nowrap text-slate-500">
            {use.pending_count > 0 && use.pending_supply !== 0 ? money(use.pending_supply) : '금액 미정'}
          </span>
        </>
      )}
      {approved && use.pending_count > 0 && use.pending_supply !== 0 && (
        <span className="num text-xs whitespace-nowrap text-slate-500">
          + 검수 전 {money(use.pending_supply)}
        </span>
      )}
    </span>
  );
}
function UseRows({ uses, title }: { uses: Use[]; title: 'date' | 'project' }) {
  return (
    <ul className="divide-y divide-slate-200">
      {uses.map((use) => (
        <li key={use.id}>
          <article>
            <a
              href={`/d/uses/${use.id}`}
              className="flex min-h-14 items-start justify-between gap-3 px-4 py-3 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-700"
            >
              <span className="min-w-0 space-y-0.5">
                <span className="block font-semibold">
                  {title === 'date' ? dateLabel(use.use_date) : use.project_name}
                </span>
                <span className="block text-[0.9375rem]">{use.route_summary ?? '경로 미입력'}</span>
                <span className="block text-sm text-slate-600">
                  <span className="num break-all">{use.use_no}</span> ·{' '}
                  {use.operation_status === 'CANCELED' ? '취소' : reviews[use.review_status]}
                  {use.operation_status !== 'CANCELED' && use.held_count > 0 && ` · 보류 ${use.held_count}건`}
                </span>
              </span>
              <Amount use={use} />
            </a>
          </article>
        </li>
      ))}
    </ul>
  );
}
/** 묶음(현장·날짜)의 합계: 승인 금액 크게, 검수 전은 있을 때만 작게. */
function GroupTotal({
  approved,
  pending,
  unpriced,
}: {
  approved: number;
  pending: number;
  unpriced: number;
}) {
  // 승인된 금액이 없으면 검수 전 금액을 회색으로 크게 보여 "0원"만 덩그러니 남지 않게 한다.
  const onlyPending = approved === 0 && pending !== 0;
  return (
    <span className="flex shrink-0 flex-col items-end">
      {onlyPending ? (
        <>
          <span className="text-xs font-semibold text-slate-500">검수 전</span>
          <span className="num text-xl font-bold whitespace-nowrap text-slate-500">{money(pending)}</span>
        </>
      ) : (
        <>
          <span className="sr-only">승인 </span>
          <span className="num text-xl font-bold whitespace-nowrap">{money(approved)}</span>
          {pending !== 0 && (
            <span className="num text-sm whitespace-nowrap text-slate-500">검수 전 {money(pending)}</span>
          )}
        </>
      )}
      {unpriced > 0 && <span className="text-sm text-slate-500">금액 미정 {unpriced}건</span>}
    </span>
  );
}
export function UseViews({
  data,
  view,
  onView,
}: {
  data: Data;
  view: 'project' | 'date';
  onView: (view: 'project' | 'date') => void;
}) {
  const totals = data.period_totals;
  return (
    <div className="min-w-0 space-y-3 break-keep [overflow-wrap:anywhere]">
      <p aria-label="기간 운행 합계" className="flex flex-wrap gap-x-1 gap-y-1 font-semibold">
        <span>운행 {totals.count}건 ·</span>
        <span className="whitespace-nowrap">
          승인 {money(totals.approved_supply)}
          {totals.pending_supply !== 0 && ' ·'}
        </span>
        {totals.pending_supply !== 0 && (
          <span className="whitespace-nowrap">검수 전 {money(totals.pending_supply)}</span>
        )}
      </p>
      <p className="text-sm text-slate-700">
        운행 금액은 세금 제외 기준입니다. 검수 전 금액은 검수 후 달라질 수 있습니다.
        {totals.unpriced_count > 0 && ' 금액 미정 항목은 합계에 포함하지 않았습니다.'}
        {totals.canceled_count > 0 && ` 취소 ${totals.canceled_count}건은 합계에서 제외했습니다.`}
      </p>
      <div role="group" aria-label="운행 보기" className="grid grid-cols-2 gap-1 rounded-lg bg-slate-200 p-1">
        {(['project', 'date'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={view === mode}
            onClick={() => onView(mode)}
            className={`min-h-14 rounded-md px-3 py-2 font-bold ${view === mode ? 'bg-white text-blue-800 shadow-sm' : 'text-slate-700'}`}
          >
            {mode === 'project' ? '현장별' : '날짜별'}
          </button>
        ))}
      </div>
      {view === 'project'
        ? data.projects.map((project) => (
            <details key={project.project_id} className="group rounded-lg border border-slate-200 bg-white">
              <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 p-4 focus-visible:outline-2 focus-visible:outline-blue-700 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-bold">{project.project_name}</span>
                  <span className="mt-0.5 block text-sm text-slate-600">
                    운행 {project.count}건 · {project.trip_count}회
                  </span>
                </span>
                <GroupTotal
                  approved={project.approved_supply}
                  pending={project.pending_supply}
                  unpriced={project.unpriced_count}
                />
                <svg
                  aria-hidden="true"
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0 text-slate-500 transition-transform group-open:rotate-180"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </summary>
              <div className="border-t border-slate-200">
                <UseRows uses={project.uses} title="date" />
              </div>
            </details>
          ))
        : data.dates.map((day) => (
            <section
              key={day.date}
              aria-label={dateLabel(day.date)}
              className="rounded-lg border border-slate-200 bg-white"
            >
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                <h3 className="font-bold">{dateLabel(day.date)}</h3>
                <GroupTotal
                  approved={day.approved_supply}
                  pending={day.pending_supply}
                  unpriced={day.unpriced_count}
                />
              </div>
              <UseRows uses={day.uses} title="project" />
            </section>
          ))}
    </div>
  );
}
