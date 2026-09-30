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
function UseRows({ uses }: { uses: Use[] }) {
  return (
    <ul className="divide-y divide-slate-200">
      {uses.map((use) => (
        <li key={use.id}>
          <article>
            <a
              href={`/d/uses/${use.id}`}
              className="block min-h-14 space-y-1 p-4 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-700"
            >
              <p className="font-semibold">
                {dateLabel(use.use_date)} · {use.project_name}
              </p>
              <p>{use.route_summary ?? '경로 미입력'}</p>
              <p className="text-sm text-slate-700">
                <span className="num break-all">{use.use_no}</span> ·{' '}
                {use.operation_status === 'CANCELED' ? '취소' : reviews[use.review_status]}
                {use.operation_status !== 'CANCELED' && use.held_count > 0 && ` · 보류 ${use.held_count}건`}
              </p>
              {use.operation_status === 'CANCELED' ? (
                <p className="text-sm text-slate-700">합계에서 제외</p>
              ) : (
                <>
                  <p className="num font-bold whitespace-nowrap">
                    <span className="sr-only">인정 공급가 </span>
                    {use.review_status === 'APPROVED' || use.approved_supply !== 0
                      ? money(use.approved_supply)
                      : '검수 전'}
                  </p>
                  {use.pending_count > 0 && (
                    <p className="text-sm text-slate-700">
                      검수 전 <span className="num whitespace-nowrap">{money(use.pending_supply)}</span>
                      {use.unpriced_count > 0 && ' · 금액 미정 포함'}
                    </p>
                  )}
                </>
              )}
            </a>
          </article>
        </li>
      ))}
    </ul>
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
        <span className="whitespace-nowrap">승인 {money(totals.approved_supply)} ·</span>
        <span className="whitespace-nowrap">검수 전 {money(totals.pending_supply)}</span>
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
            <details key={project.project_id} className="rounded-lg border border-slate-200 bg-white">
              <summary className="min-h-14 cursor-pointer p-4 focus-visible:outline-2 focus-visible:outline-blue-700">
                <span className="font-bold">{project.project_name}</span>
                <span className="mt-1 block text-sm text-slate-700">
                  운행 {project.count}건 · {project.trip_count}회
                </span>
                <span className="num mt-2 block text-[1.5rem] font-bold whitespace-nowrap">
                  <span className="sr-only">승인 </span>
                  {money(project.approved_supply)}
                </span>
                {project.pending_supply !== 0 && (
                  <span className="mt-1 block text-sm text-slate-700">
                    검수 전 <span className="num whitespace-nowrap">{money(project.pending_supply)}</span>
                  </span>
                )}
                {project.unpriced_count > 0 && (
                  <span className="block text-sm text-slate-700">검수 전 금액 미정 포함</span>
                )}
                <span className="mt-2 block text-sm font-semibold text-blue-800">운행 목록 펼치기·접기</span>
              </summary>
              <div className="border-t border-slate-200">
                <UseRows uses={project.uses} />
              </div>
            </details>
          ))
        : data.dates.map((day) => (
            <section
              key={day.date}
              aria-label={dateLabel(day.date)}
              className="rounded-lg border border-slate-200 bg-white"
            >
              <div className="space-y-1 border-b border-slate-200 bg-slate-50 p-4">
                <h3 className="font-bold">{dateLabel(day.date)}</h3>
                <p className="num font-bold whitespace-nowrap">승인 {money(day.approved_supply)}</p>
                {day.pending_supply !== 0 && (
                  <p className="text-sm text-slate-700">
                    검수 전 <span className="num whitespace-nowrap">{money(day.pending_supply)}</span>
                  </p>
                )}
                {day.unpriced_count > 0 && <p className="text-sm text-slate-700">검수 전 금액 미정 포함</p>}
              </div>
              <UseRows uses={day.uses} />
            </section>
          ))}
    </div>
  );
}
