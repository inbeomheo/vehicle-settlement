'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { errorMessage } from './error-message';
import { useActionLock } from './use-action-lock';
import { reviewLabels, todaySeoul, type UseList } from './types';
import { useBootstrap, PwaRegistration } from './offline/runtime';
import { isUnsent, listDrafts, OFFLINE_EVENT, type Draft } from './offline/store';
import { copyToDevice } from './copy-draft';
import { syncQueue } from './offline/engine';
import { button, primary, Section, StatusBadge } from '@/components/use-form/fields';
import { ApprovalDates, ApprovalSelect, ApprovalTabs, useApprovalQuery } from '@/components/approval-filters';
import { Pager } from '@/components/list-controls';
import { useRemote } from './use-remote';
import { Plate } from '@/components/ui/plate';

const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
function weekday(date: string) {
  return weekdays[new Date(`${date}T12:00:00Z`).getUTCDay()];
}
function koreanDate(date: string, withWeekday = true) {
  const text = `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`;
  return withWeekday ? `${text} ${weekday(date)}요일` : text;
}
export function DriverDashboard() {
  const { data, error, authRequired, retry } = useBootstrap('driver');
  const { query, search, change } = useApprovalQuery(false);
  const filtered = useRemote<
    UseList & { counts: Record<string, number>; options: { projects: { id: string; name: string }[] } }
  >(data ? `/api/approvals?${search}` : null);
  const refreshFiltered = filtered.refresh;
  const [list, setList] = useState<UseList>();
  const [todayCount, setTodayCount] = useState<number>();
  const [fixes, setFixes] = useState<UseList['rows']>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [message, setMessage] = useState('');
  const { busy, start: startAction, finish: finishAction } = useActionLock();
  const [refreshAttempt, setRefreshAttempt] = useState(0);
  const [listAuthRequired, setListAuthRequired] = useState(false);
  useEffect(() => {
    if (!data) return;
    setList(data.recent);
    const refresh = () => {
      refreshFiltered();
      setMessage('');
      setListAuthRequired(false);
      void listDrafts(data.user.id)
        .then(setDrafts)
        .catch((error) =>
          setMessage(errorMessage(error, '휴대폰 저장 내용을 불러오지 못했습니다. 다시 시도해 주세요.')),
        );
      if (navigator.onLine) {
        void api<UseList>('/api/uses?pageSize=20&sort=use_date')
          .then(setList)
          .catch((e) => {
            setMessage('잠시 후 다시 시도해 주세요.');
            setListAuthRequired(e instanceof ApiError && e.status === 401);
          });
        void api<UseList>(`/api/uses?from=${todaySeoul()}&to=${todaySeoul()}&pageSize=1`)
          .then((r) => setTodayCount(r.total))
          .catch(() => {});
        void api<UseList>('/api/uses?review_status=NEEDS_FIX&pageSize=100')
          .then((r) => setFixes(r.rows))
          .catch(() => {});
      }
    };
    refresh();
    window.addEventListener(OFFLINE_EVENT, refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    return () => {
      window.removeEventListener(OFFLINE_EVENT, refresh);
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh);
    };
  }, [data, refreshAttempt, refreshFiltered]);
  async function copy(id: string) {
    if (!data) return;
    if (!startAction()) return;
    setMessage('');
    try {
      location.assign(await copyToDevice(data.user.id, id));
    } catch (e) {
      setMessage(errorMessage(e, '복사하지 못했습니다.'));
      finishAction();
    }
  }
  if (error)
    return (
      <p role="alert">
        {errorMessage(error)}{' '}
        {authRequired ? (
          <a href="/login" className={button}>
            로그인
          </a>
        ) : (
          <button className={button} onClick={retry}>
            다시 시도
          </button>
        )}
      </p>
    );
  if (!data || !list) return <p role="status">내 운행을 불러오고 있습니다…</p>;
  const offline = typeof navigator !== 'undefined' && !navigator.onLine;
  const visibleList = offline ? list : filtered.data;
  const pending = drafts.filter(isUnsent);
  const projects = [
    ...new Map(data.recent.rows.map((r) => [r.project_id, String(r.snapshot.project_name)])).entries(),
  ].slice(0, 5);
  const latest = list.rows.find((row) => row.operation_status !== 'CANCELED');
  const today = todayCount ?? data.recent.rows.filter((r) => r.use_date === todaySeoul()).length;
  return (
    <div className="space-y-6">
      <PwaRegistration />
      <div>
        <p className="text-[0.9375rem] text-slate-700">{koreanDate(todaySeoul())}</p>
        <h1 className="mt-0.5 text-[1.75rem] font-bold">{data.user.name}님</h1>
        <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-slate-600">
          <span>오늘 {today}건 등록</span>
          <span className={pending.length > 0 ? 'font-semibold text-orange-800' : undefined}>
            <span>기기 미전송</span> {pending.length}건
          </span>
        </p>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5">
        <a href="/d/new" className={`${primary} min-h-16 w-full gap-2 text-xl`}>
          <svg
            aria-hidden="true"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          운행 등록
        </a>
        {latest && (
          <button
            type="button"
            className={`${button} min-h-14 w-full justify-start gap-3 text-left`}
            disabled={busy}
            onClick={() => void copy(latest.id)}
          >
            <svg
              aria-hidden="true"
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0"
            >
              <path d="M20 11a8 8 0 0 0-14.9-4M4 4v4h4M4 13a8 8 0 0 0 14.9 4M20 20v-4h-4" />
            </svg>
            <span className="min-w-0 flex-1">
              지난번과 같은 운행
              <span className="mt-0.5 block truncate text-sm font-normal text-slate-600">
                {String(latest.snapshot.project_name)} ·{' '}
                {latest.route_summary ?? String(latest.snapshot.plate_no)}
              </span>
            </span>
          </button>
        )}
      </div>

      {message && (
        <p role="alert" className="flex flex-wrap items-center gap-2 rounded-lg bg-red-50 p-4 text-red-800">
          {message}
          {listAuthRequired ? (
            <a href="/login" className={button}>
              로그인
            </a>
          ) : (
            <button className={button} onClick={() => setRefreshAttempt((value) => value + 1)}>
              다시 시도
            </button>
          )}
        </p>
      )}

      {fixes.length > 0 && (
        <section aria-label="보완 요청" className="grid grid-cols-[minmax(0,1fr)] gap-2">
          {fixes.map((row) => (
            <a
              key={row.id}
              href={`/d/uses/${row.id}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-l-4 border-slate-200 border-l-orange-500 bg-white px-4 py-3"
            >
              <span className="min-w-0">
                <span className="block font-bold text-orange-700">보완 요청</span>
                <span className="line-clamp-2 block text-[0.9375rem] break-keep">
                  {koreanDate(row.use_date, false)} · {row.fix_message ?? String(row.snapshot.project_name)}
                </span>
              </span>
              <span className="shrink-0 rounded-lg bg-orange-50 px-3 py-2 text-sm font-bold text-orange-800">
                고치기
              </span>
            </a>
          ))}
        </section>
      )}

      {pending.length > 0 && (
        <Section title="이 휴대폰에만 있는 운행">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
            {pending.map((d) => (
              <a
                key={d.id}
                href={`${d.serverId ? `/d/uses/${d.serverId}` : '/d/new'}?draft=${d.id}`}
                className="rounded-lg border border-slate-200 bg-white p-3"
              >
                <p className="font-semibold">
                  {d.form.use_date} ·{' '}
                  {data.lookups.projects.find((p) => p.id === d.form.project_id)?.name ?? '현장 선택 전'}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <StatusBadge>{d.savedRequest ? '작성 중 · 아직 안 보냄' : '휴대폰에만 저장됨'}</StatusBadge>
                  {d.uploads.some((f) => f.status === 'failed') ? (
                    <StatusBadge warning>사진 업로드 실패</StatusBadge>
                  ) : d.uploads.some((f) => f.status !== 'uploaded') ? (
                    <StatusBadge warning>사진 업로드 대기</StatusBadge>
                  ) : null}
                  {d.phase === 'blocked' && <StatusBadge warning>재전송 중단</StatusBadge>}
                  {d.phase === 'conflict' && <StatusBadge warning>최신 내용 확인 필요</StatusBadge>}
                </div>
                {d.error && <p className="mt-2 text-sm text-red-700">{errorMessage(d.error)}</p>}
              </a>
            ))}
          </div>
          <button
            type="button"
            className={`${button} mt-3 w-full`}
            disabled={busy}
            onClick={async () => {
              if (!startAction()) return;
              try {
                await syncQueue(data.user.id, true);
              } catch (error) {
                setMessage(errorMessage(error, '전송하지 못했습니다. 다시 시도해 주세요.'));
              } finally {
                finishAction();
              }
            }}
          >
            미전송 다시 보내기
          </button>
        </Section>
      )}

      {projects.length > 1 && (
        <div>
          <p className="mb-2 text-sm font-semibold text-slate-600">최근 현장으로 등록</p>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {projects.map(([id, name]) => (
              <a
                key={id}
                href={`/d/new?project=${id}`}
                className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-slate-300 bg-white px-4 text-[0.9375rem] font-semibold"
              >
                {name}
              </a>
            ))}
          </div>
        </div>
      )}

      <section aria-labelledby="my-uses">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="my-uses" className="text-xl font-bold">
            내 운행
          </h2>
          <span className="text-sm text-slate-600">{visibleList?.total ?? 0}건</span>
        </div>
        {offline ? (
          <p className="mb-4 text-slate-600">
            인터넷 연결이 없어 최근 저장된 운행을 보여 드립니다. 날짜·프로젝트 검색은 연결 후 사용할 수
            있습니다.
          </p>
        ) : (
          <>
            <ApprovalTabs
              driver
              status={query.review_status}
              counts={filtered.data?.counts}
              onChange={(value) => change({ review_status: value })}
            />
            <details className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
              <summary className="min-h-11 cursor-pointer font-bold">
                운송일자·프로젝트 필터 ·{' '}
                {query.from || query.to ? `${query.from || '처음'} ~ ${query.to || '최근'}` : '전체 기간'}
              </summary>
              <div className="grid gap-4">
                <ApprovalDates driver from={query.from} to={query.to} onChange={change} />
                <label className="grid gap-2">
                  프로젝트
                  <ApprovalSelect
                    driver
                    title="프로젝트"
                    value={query.project_id}
                    options={filtered.data?.options.projects ?? data.lookups.projects}
                    onChange={(value) => change({ project_id: value })}
                  />
                </label>
              </div>
            </details>
          </>
        )}
        {!offline && filtered.error && (
          <p role="alert" className="my-3 text-red-700">
            {filtered.error}{' '}
            <button className={button} onClick={filtered.refresh}>
              다시 시도
            </button>
          </p>
        )}
        {!offline && filtered.loading && <p role="status">내 운행을 불러오는 중…</p>}
        {visibleList?.rows.length === 0 ? (
          <p className="rounded-lg bg-white py-10 text-center text-slate-600">
            해당하는 운행이 없습니다. 날짜나 프로젝트를 바꿔 보세요.
          </p>
        ) : (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-2.5">
            {visibleList?.rows.map((row) => {
              const canceled = row.operation_status === 'CANCELED';
              const fix = row.review_status === 'NEEDS_FIX';
              return (
                <li key={row.id}>
                  <a
                    href={`/d/uses/${row.id}`}
                    className={`slip relative flex rounded-lg border bg-white ${fix ? 'border-orange-300' : 'border-slate-200'} ${canceled ? 'opacity-60' : ''}`}
                  >
                    <span className="flex w-[4.5rem] shrink-0 flex-col items-center justify-center py-3">
                      <span className="text-sm font-semibold text-slate-700">
                        {Number(row.use_date.slice(5, 7))}월
                      </span>
                      <span className="num text-[1.75rem] leading-none font-bold">
                        {row.use_date.slice(8, 10)}
                      </span>
                      <span className="mt-0.5 text-sm font-semibold text-slate-700">
                        {weekday(row.use_date)}
                      </span>
                    </span>
                    <span aria-hidden="true" className="slip-perforation w-2 shrink-0" />
                    <span className="min-w-0 flex-1 py-3 pr-3 pl-2">
                      {/* 현장 이름은 한 줄을 온전히 쓰고, 상태는 번호판 옆에 둔다(긴 상태 문구가 이름을 가리지 않게). */}
                      <span className="block break-words text-[1.0625rem] font-bold">
                        {String(row.snapshot.project_name)}
                        {row.entered_as === 'PROXY' && (
                          <span className="ml-1.5 text-sm font-medium text-slate-700">대리 입력</span>
                        )}
                      </span>
                      <span className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                        <Plate value={String(row.snapshot.plate_no)} size="sm" />
                        <StatusBadge warning={fix}>
                          {canceled ? '취소' : reviewLabels[row.review_status]}
                        </StatusBadge>
                      </span>
                      {!canceled && (
                        <span className="mt-2 flex flex-wrap items-end justify-between gap-2 text-sm">
                          <span className="min-w-0 break-words text-slate-600">
                            {row.route_summary ?? row.cargo_desc ?? ''}
                          </span>
                          <span className="num shrink-0 text-lg font-bold">
                            {row.payable_base_amount == null
                              ? '미확정'
                              : `${row.payable_base_amount.toLocaleString('ko-KR')}원`}
                          </span>
                        </span>
                      )}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
        {!offline && visibleList && visibleList.total > visibleList.pageSize && (
          <Pager
            page={visibleList.page}
            pageSize={visibleList.pageSize}
            total={visibleList.total}
            onChange={(page) => change({ page: String(page) })}
          />
        )}
      </section>
      <p className="flex flex-wrap justify-center gap-x-4 pt-2 text-center">
        <a
          href="/d/profile"
          className="inline-flex min-h-12 items-center font-semibold text-slate-700 underline underline-offset-4"
        >
          내 정보
        </a>
        <a
          href="/manual#driver"
          className="inline-flex min-h-12 items-center font-semibold text-slate-700 underline underline-offset-4"
        >
          쓰는 법이 궁금하면 사용 설명서
        </a>
        <a
          href="/d/account"
          className="inline-flex min-h-12 items-center font-semibold text-slate-700 underline underline-offset-4"
        >
          비밀번호 변경
        </a>
      </p>
    </div>
  );
}
