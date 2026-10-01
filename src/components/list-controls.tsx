'use client';

export const inputClass =
  'w-full min-h-11 min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base shadow-[inset_0_1px_0_rgb(0_0_0/0.03)] focus:border-blue-700 focus:outline-none focus:ring-3 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-500';

export const secondaryClass =
  'inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-ink hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50';

export function Pager({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
      <span>
        전체 {total.toLocaleString('ko-KR')}건 · {page} / {Math.max(1, Math.ceil(total / pageSize))}페이지
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          className={secondaryClass}
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          이전
        </button>
        <button
          type="button"
          className={secondaryClass}
          disabled={page * pageSize >= total}
          onClick={() => onChange(page + 1)}
        >
          다음
        </button>
      </div>
    </div>
  );
}
