'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { todaySeoul, reviewLabels, type UseList } from './types';
import { useBootstrap, PwaRegistration } from './offline/runtime';
import { isUnsent, listDrafts, OFFLINE_EVENT, type Draft } from './offline/store';
import { copyToDevice } from './copy-draft';
import { syncQueue } from './offline/engine';
import { button, primary, Section, StatusBadge } from '@/components/use-form/fields';
export function DriverDashboard() {
  const { data, error, authRequired, retry } = useBootstrap('driver');
  const [list, setList] = useState<UseList>();
  const [todayCount, setTodayCount] = useState<number>();
  const [fixes, setFixes] = useState<UseList['rows']>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [copyMenu, setCopyMenu] = useState<string>();
  const [refreshAttempt, setRefreshAttempt] = useState(0);
  const [listAuthRequired, setListAuthRequired] = useState(false);
  useEffect(() => {
    if (!data) return;
    setList(data.recent);
    const refresh = () => {
      setMessage('');
      setListAuthRequired(false);
      void listDrafts(data.user.id).then(setDrafts);
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
    return () => {
      window.removeEventListener(OFFLINE_EVENT, refresh);
      window.removeEventListener('online', refresh);
    };
  }, [data, refreshAttempt]);
  async function copy(id: string) {
    if (!data) return;
    setBusy(true);
    setMessage('');
    try {
      location.assign(await copyToDevice(data.user.id, id));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '복사하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }
  if (error)
    return (
      <p role="alert">
        {error}{' '}
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
  const pending = drafts.filter(isUnsent);
  const projects = [
    ...new Map(data.recent.rows.map((r) => [r.project_id, String(r.snapshot.project_name)])).entries(),
  ].slice(0, 5);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PwaRegistration />
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">{todaySeoul()}</p>
          <h1 className="mt-1 text-2xl font-bold">{data.user.name}님의 운행</h1>
        </div>
        <a href="/d/new" className={primary}>
          운행 등록
        </a>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-blue-800 p-5 text-white">
          <p className="text-sm text-blue-100">오늘 운행</p>
          <p className="mt-2 text-3xl font-bold">
            {todayCount ?? data.recent.rows.filter((r) => r.use_date === todaySeoul()).length}
            <span className="ml-1 text-base">건</span>
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-600">기기 미전송</p>
          <p className="mt-2 text-3xl font-bold">
            {pending.length}
            <span className="ml-1 text-base">건</span>
          </p>
        </div>
      </div>
      {message && (
        <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">
          {message}
          {listAuthRequired ? (
            <a href="/login" className={button}>
              로그인
            </a>
          ) : (
            <button className={`${button} ml-2`} onClick={() => setRefreshAttempt((value) => value + 1)}>
              다시 시도
            </button>
          )}
        </p>
      )}
      {fixes.length > 0 && (
        <Section title={`보완 요청 · ${fixes.length}건`}>
          <ul className="grid gap-3">
            {fixes.map((row) => (
              <li key={row.id}>
                <a
                  className="block rounded-xl border border-amber-300 bg-amber-50 p-4 font-semibold text-amber-900"
                  href={`/d/uses/${row.id}`}
                >
                  {row.use_date} · {String(row.snapshot.project_name)}
                  <span className="mt-1 block text-sm">요청 항목 확인·재제출 →</span>
                </a>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {pending.length > 0 && (
        <Section title="이 휴대폰에 보관된 운행">
          <button
            type="button"
            className={`${button} mb-4 w-full`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await syncQueue(data.user.id, true);
              } finally {
                setBusy(false);
              }
            }}
          >
            미전송 다시 보내기
          </button>
          <div className="grid gap-3">
            {pending.map((d) => (
              <a
                key={d.id}
                href={`${d.serverId ? `/d/uses/${d.serverId}` : '/d/new'}?draft=${d.id}`}
                className="rounded-xl border border-slate-200 p-4"
              >
                <p className="font-bold">
                  {d.form.use_date} ·{' '}
                  {data.lookups.projects.find((p) => p.id === d.form.project_id)?.name ?? '현장 선택 전'}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <StatusBadge>{d.savedRequest ? '서버 저장(작성중)' : '휴대폰 임시저장'}</StatusBadge>
                  {d.uploads.some((f) => f.status === 'failed') ? (
                    <StatusBadge warning>사진 업로드 실패</StatusBadge>
                  ) : d.uploads.some((f) => f.status !== 'uploaded') ? (
                    <StatusBadge warning>사진 업로드 대기</StatusBadge>
                  ) : null}
                  {d.phase === 'blocked' && <StatusBadge warning>재전송 중단</StatusBadge>}
                  {d.phase === 'conflict' && <StatusBadge warning>최신 내용 확인 필요</StatusBadge>}
                </div>
                {d.error && <p className="mt-2 text-sm text-red-700">{d.error}</p>}
              </a>
            ))}
          </div>
        </Section>
      )}
      {projects.length > 0 && (
        <Section title="최근 사용 현장">
          <div className="flex flex-wrap gap-2">
            {projects.map(([id, name]) => (
              <a key={id} href={`/d/new?project=${id}`} className={button}>
                {name}
              </a>
            ))}
          </div>
        </Section>
      )}
      <Section title="내 운행 목록">
        <p className="mb-4 text-sm text-slate-500">전체 {list.total}건 · 사용일 최신순 · 같은 날 입력순</p>
        {list.rows.length === 0 ? (
          <p className="py-8 text-center text-slate-500">등록된 운행이 없습니다. 첫 운행을 등록해 주세요.</p>
        ) : (
          <ul className="grid gap-4">
            {list.rows.map((row) => (
              <li key={row.id} className="rounded-xl border border-slate-200 p-4">
                <a className="block" href={`/d/uses/${row.id}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm text-slate-500">{row.use_date}</span>
                    <StatusBadge warning={row.review_status === 'NEEDS_FIX'}>
                      {row.operation_status === 'CANCELED' ? '취소' : reviewLabels[row.review_status]}
                    </StatusBadge>
                  </div>
                  <p className="mt-3 font-bold">
                    {String(row.snapshot.project_name)} · {String(row.snapshot.plate_no)}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">{row.cargo_desc || '운반 내용 없음'}</p>
                  {row.operation_status !== 'CANCELED' && (
                    <p className="mt-2 text-sm font-semibold">
                      기본 금액 (본인 지급분){' '}
                      {row.payable_base_amount == null
                        ? '미확정'
                        : `${row.payable_base_amount.toLocaleString('ko-KR')}원`}
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        {row.payable_base_approved ? '승인 공급가' : '검수 전 계산액'}
                      </span>
                    </p>
                  )}
                  <p className="mt-1 text-xs text-slate-400">
                    {row.use_no}
                    {row.entered_as === 'PROXY' ? ' · 대리 입력' : ''}
                  </p>
                </a>
                <button
                  type="button"
                  className="mt-3 min-h-11 px-2 text-sm text-slate-600 underline underline-offset-4"
                  disabled={busy}
                  aria-haspopup="menu"
                  aria-expanded={copyMenu === row.id}
                  onClick={() => {
                    setCopyMenu(copyMenu === row.id ? undefined : row.id);
                  }}
                >
                  이전 운행 복사
                </button>
                {copyMenu === row.id && (
                  <div role="menu" aria-label="운행 보조 메뉴" className="mt-2 rounded-xl border p-3">
                    <button
                      role="menuitem"
                      className={button}
                      disabled={busy}
                      onClick={() => {
                        void copy(row.id);
                      }}
                    >
                      새 기기 초안으로 복사
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {list.rows.length < list.total && (
          <button
            type="button"
            className={`${button} mt-4 w-full`}
            onClick={async () => {
              try {
                const next = await api<UseList>(`/api/uses?pageSize=20&sort=use_date&page=${list.page + 1}`);
                setList({ ...next, rows: [...list.rows, ...next.rows] });
              } catch (e) {
                setMessage(e instanceof Error ? e.message : '목록 조회 실패');
              }
            }}
          >
            더 보기
          </button>
        )}
      </Section>
    </div>
  );
}
