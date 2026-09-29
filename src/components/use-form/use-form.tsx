'use client';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, mutate } from '@/client/api';
import {
  type Mode,
  type UseDetail,
  type Lookups,
  reviewLabels,
  operationLabels,
  money,
} from '@/client/types';
import { useBootstrap, PwaRegistration } from '@/client/offline/runtime';
import {
  activeUser,
  cacheValue,
  cachedValue,
  getDraft,
  listDrafts,
  putDraft,
  removeDraft,
  OFFLINE_EVENT,
  type Bootstrap,
  type Draft,
} from '@/client/offline/store';
import { syncQueue, withQueuePaused } from '@/client/offline/engine';
import { copyToDevice } from '@/client/copy-draft';
import { useFormSettings } from './settings';
import { revealDraftFields } from './visibility';
import { ReadOnlyUse } from './read-only';
import { evidenceError } from './evidence-policy';
import { EvidenceEditor } from '@/components/evidence/editor';
import { button, control, primary, Field, Section, FormContexts, StatusBadge } from './fields';
import { ChargeFields } from './charges';
import { TripFields } from './trips';
import {
  defaultPayee,
  fromUse,
  initialValues,
  newCharge,
  resetBaseRates,
  toInput,
  validate,
  type FormValues,
} from './model';

export function UseFormPage({ mode, useId }: { mode: Mode; useId?: string }) {
  const { data, error, authRequired, retry } = useBootstrap(mode);
  if (error)
    return (
      <p role="alert">
        {error}{' '}
        {authRequired ? (
          <a className={button} href="/login">
            로그인
          </a>
        ) : (
          <button className={button} onClick={retry}>
            다시 시도
          </button>
        )}
      </p>
    );
  if (!data) return <p role="status">입력 화면을 불러오고 있습니다…</p>;
  return (
    <>
      <PwaRegistration />
      <FormWorkspace boot={data} mode={mode} useId={useId} />
    </>
  );
}
export function FormWorkspace({ boot, mode, useId }: { boot: Bootstrap; mode: Mode; useId?: string }) {
  const [draft, setDraft] = useState<Draft>();
  const settings = useFormSettings(boot.user.id, draft?.form.project_id, mode);
  const current = useRef<Draft | undefined>(undefined);
  const [lookups, setLookups] = useState(boot.lookups);
  const [recent, setRecent] = useState<UseDetail[]>([]);
  const [error, setError] = useState('');
  const [validation, setValidation] = useState<string[]>([]);
  const [localSaved, setLocalSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const [editApproved, setEditApproved] = useState(false);
  const [approvalConfirm, setApprovalConfirm] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [evidenceValidation, setEvidenceValidation] = useState('');
  const persistence = useRef<Promise<void>>(Promise.resolve());
  current.current = draft;
  useEffect(() => {
    if (settings.ready) setDraft((value) => (value ? revealDraftFields(value, settings.modes) : value));
  }, [draft, settings.ready, settings.modes]);
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const params = new URLSearchParams(location.search);
        const localId = params.get('draft');
        let found = localId
          ? await getDraft(boot.user.id, localId)
          : (await listDrafts(boot.user.id)).find(
              (d) => d.mode === mode && (useId ? d.serverId === useId : !d.serverId) && d.phase !== 'saved',
            );
        if (found && found.mode !== mode) found = undefined;
        if (!found) {
          let server: UseDetail | undefined;
          if (useId) {
            try {
              server = await api<UseDetail>(`/api/uses/${useId}`);
              await cacheValue(boot.user.id, `use:${useId}`, server);
            } catch (e) {
              if (e instanceof ApiError) throw e;
              server = await cachedValue<UseDetail>(boot.user.id, `use:${useId}`);
              if (!server) throw new Error('오프라인에서 열 수 없는 운행입니다. 연결 후 다시 열어 주세요.');
            }
          }
          found = {
            id: crypto.randomUUID(),
            userId: boot.user.id,
            mode,
            form: server
              ? fromUse(server, mode)
              : initialValues(boot.lookups, params.get('project') ?? boot.recent.rows[0]?.project_id),
            uploads: [],
            updatedAt: Date.now(),
            phase: server ? 'saved' : 'editing',
            server,
            serverId: server?.id,
            version: server?.version,
          };
        }
        // A local draft must not hide a newer approval or statement lock.
        if (found.serverId && found.phase !== 'saved') {
          try {
            const server = await api<UseDetail>(`/api/uses/${found.serverId}`);
            found = { ...found, server };
          } catch (error) {
            if (error instanceof ApiError) throw error;
          }
        }
        if (alive) {
          setDraft(found);
          setLocalSaved(true);
        }
        const details = await Promise.all(
          boot.recent.rows.slice(0, 5).map(async (row) => {
            try {
              const detail = await api<UseDetail>(`/api/uses/${row.id}`);
              await cacheValue(boot.user.id, `use:${row.id}`, detail);
              return detail;
            } catch (e) {
              return e instanceof ApiError
                ? undefined
                : cachedValue<UseDetail>(boot.user.id, `use:${row.id}`);
            }
          }),
        );
        if (alive) setRecent(details.filter((d): d is UseDetail => !!d));
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : '불러오지 못했습니다.');
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, [boot, mode, useId]);
  useEffect(() => {
    if (!draft || draft.phase !== 'editing') return;
    setLocalSaved(false);
    const timer = window.setTimeout(() => {
      persistence.current = persistence.current.then(() => putDraft(draft));
      void persistence.current
        .then(() => setLocalSaved(true))
        .catch(() =>
          setError(
            '휴대폰 저장 공간이 부족하거나 저장할 수 없습니다. 연결 상태를 확인하고 서버 저장을 눌러 주세요.',
          ),
        );
    }, 450);
    return () => clearTimeout(timer);
  }, [draft]);
  useEffect(() => {
    const flush = () => {
      if (current.current?.phase === 'editing') {
        const value = current.current;
        persistence.current = persistence.current.then(() => putDraft(value));
      }
    };
    const flushRequested = (event: Event) => {
      flush();
      (event as CustomEvent<{ waitUntil: (promise: Promise<void>) => void }>).detail.waitUntil(
        persistence.current,
      );
    };
    const update = () => {
      const value = current.current;
      if (!value || value.phase !== 'queued') return;
      void getDraft(boot.user.id, value.id).then((next) => {
        if (next && current.current?.phase === 'queued') {
          setLocalSaved(true);
          if (next.phase === 'saved') setEditApproved(false);
          setDraft(
            next.phase === 'saved' && next.server ? { ...next, form: fromUse(next.server, mode) } : next,
          );
          if (next.phase === 'saved' && mode === 'manager' && next.serverId)
            location.assign(`/m/uses/${next.serverId}`);
        }
      });
    };
    const connectivity = () => setOnline(navigator.onLine);
    connectivity();
    window.addEventListener(OFFLINE_EVENT, update);
    window.addEventListener('online', connectivity);
    window.addEventListener('offline', connectivity);
    window.addEventListener('pagehide', flush);
    window.addEventListener('vehicle-flush-drafts', flushRequested);
    const periodicSave = window.setInterval(flush, 3000);
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      flush();
      window.removeEventListener(OFFLINE_EVENT, update);
      window.removeEventListener('online', connectivity);
      window.removeEventListener('offline', connectivity);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('vehicle-flush-drafts', flushRequested);
      clearInterval(periodicSave);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [boot.user.id, mode]);
  const date = draft?.form.use_date;
  useEffect(() => {
    if (!date) return;
    let alive = true;
    const key = `lookups:${date}`;
    void api<Lookups>(`/api/lookups?use_date=${date}`)
      .then(async (value) => {
        await cacheValue(boot.user.id, key, value);
        if (alive) setLookups(value);
      })
      .catch(async (e: unknown) => {
        if (e instanceof ApiError) {
          if (alive) setError(e.message);
          return;
        }
        const value = await cachedValue<Lookups>(boot.user.id, key);
        if (alive && value) setLookups(value);
      });
    return () => {
      alive = false;
    };
  }, [date, boot.user.id]);
  function edit(patch: Partial<Draft> | ((value: Draft) => Partial<Draft>)) {
    if (busy) return;
    setDraft((value) => {
      if (!value || ['queued', 'conflict', 'blocked'].includes(value.phase)) return value;
      return {
        ...(settings.ready ? revealDraftFields(value, settings.modes) : value),
        ...(typeof patch === 'function' ? patch(value) : patch),
        phase: 'editing',
        updatedAt: Date.now(),
        request: undefined,
        savedRequest: false,
        submitRequest: undefined,
        error: undefined,
        inputError: false,
      };
    });
    setValidation([]);
    setEvidenceValidation('');
  }

  function change(patch: Partial<FormValues>) {
    const rateContextChanged = [
      'driver_id',
      'vehicle_id',
      'use_date',
      'project_id',
      'payee_counterparty_id',
      'customer_counterparty_id',
    ].some((key) => key in patch && patch[key as keyof FormValues] !== draft?.form[key as keyof FormValues]);
    edit((value) => ({
      form: {
        ...value.form,
        ...patch,
        ...(rateContextChanged ? { charges: resetBaseRates(patch.charges ?? value.form.charges) } : {}),
      },
    }));
  }
  async function enqueue(intent: 'save' | 'submit') {
    if (!draft || busy || evidenceBusy || activeUser() !== boot.user.id) return;
    if (
      draft.server?.is_locked ||
      (mode === 'driver' && draft.server?.review_status === 'APPROVED' && !editApproved)
    )
      return;
    if (!settings.ready) return;
    setBusy(true);
    setError('');
    try {
      const modes = intent === 'submit' ? await settings.refresh() : settings.modes;
      const errors = validate(draft.form, intent, modes);
      const missingEvidence =
        intent === 'submit'
          ? evidenceError(
              lookups.projects.find((p) => p.id === draft.form.project_id)?.evidence_policy,
              draft.server?.evidence ?? [],
              draft.uploads,
            )
          : '';
      setEvidenceValidation(missingEvidence);
      setValidation(errors);
      if (missingEvidence) {
        scrollTo('evidence');
        return;
      }
      if (errors.length) {
        requestAnimationFrame(() =>
          document.getElementById('form-errors')?.scrollIntoView({ block: 'center' }),
        );
        return;
      }
      const queued: Draft = {
        ...draft,
        intent,
        inputError: false,
        phase: 'queued',
        updatedAt: Date.now(),
        request: {
          key: crypto.randomUUID(),
          payload: {
            ...toInput(draft.form, mode),
            ...(draft.serverId ? { version: draft.version } : { client_request_id: draft.id }),
          },
        },
        savedRequest: false,
        submitRequest: undefined,
        error: undefined,
      };
      await persistence.current;
      await putDraft(queued);
      setDraft(queued);
      current.current = queued;
      await syncQueue(boot.user.id);
      const result = await getDraft(boot.user.id, queued.id);
      if (result) {
        setLocalSaved(true);
        if (result.phase === 'saved') setEditApproved(false);
        setDraft(
          result.phase === 'saved' && result.server
            ? { ...result, form: fromUse(result.server, mode) }
            : result,
        );
        if (result.phase === 'saved' && mode === 'manager') location.assign(`/m/uses/${result.serverId}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    if (!draft?.serverId) return;
    const server = await api<UseDetail>(`/api/uses/${draft.serverId}`);
    const next = { ...draft, server, version: server.version };
    await putDraft(next);
    setDraft(next);
  }
  async function removePending(uploadId: string) {
    if (!draft || busy) return;
    setBusy(true);
    setError('');
    try {
      await persistence.current;
      const next = await withQueuePaused(boot.user.id, async () => {
        const value = draft.phase === 'editing' ? draft : ((await getDraft(boot.user.id, draft.id)) ?? draft);
        const file = value.uploads.find((upload) => upload.client_upload_id === uploadId);
        if (!file || file.status === 'uploaded') return value;
        if (file.serverId) {
          try {
            await mutate(
              `/api/evidence/${file.serverId}`,
              { reason: '업로드 실패 첨부 취소' },
              crypto.randomUUID(),
              'DELETE',
            );
          } catch (e) {
            setError(
              `이 기기의 대기 첨부는 제거했습니다. 서버 증빙: ${e instanceof Error ? e.message : '삭제하지 못했습니다.'}`,
            );
          }
        }
        let server = value.server;
        if (value.serverId) {
          try {
            server = await api<UseDetail>(`/api/uses/${value.serverId}`);
          } catch {
            // Local queue cancellation is available even after access is revoked.
          }
        }
        const updated: Draft = {
          ...value,
          server,
          version: server?.version ?? value.version,
          uploads: value.uploads.filter((upload) => upload.client_upload_id !== uploadId),
          phase: 'editing',
          request: undefined,
          savedRequest: false,
          submitRequest: undefined,
          error: undefined,
          updatedAt: Date.now(),
        };
        await putDraft(updated);
        return updated;
      });
      setDraft(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : '첨부를 제거하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }
  async function discard() {
    if (!draft || busy) return;
    const value = draft;
    setBusy(true);
    setDraft(undefined);
    current.current = undefined;
    try {
      await persistence.current;
      await withQueuePaused(boot.user.id, () => removeDraft(boot.user.id, value.id));
      location.assign(mode === 'driver' ? '/d' : '/m/ledger');
    } catch (e) {
      setDraft(value);
      setError(e instanceof Error ? e.message : '기기 초안을 폐기하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }
  if (!draft) return <p role={error ? 'alert' : 'status'}>{error || '기기 초안을 확인하고 있습니다…'}</p>;
  const form = draft.form;
  const revealed = new Set(
    (settings.ready ? revealDraftFields(draft, settings.modes) : draft).revealedFields,
  );
  const statementLocked =
    !!draft.server?.is_locked || !!draft.server?.charge_lines.some((line) => line.locked_statement_id);
  const readOnly =
    mode === 'driver' &&
    !!draft.server &&
    (statementLocked ||
      draft.server.operation_status === 'CANCELED' ||
      (draft.server.review_status === 'APPROVED' && !editApproved));
  const locked =
    readOnly || busy || !settings.ready || ['queued', 'blocked', 'conflict'].includes(draft.phase);
  const fixes =
    draft.server?.review_status === 'NEEDS_FIX'
      ? (draft.server.revisions.find((r) => r.decision === 'NEEDS_FIX')?.fix_items ?? [])
      : [];
  const payee =
    mode === 'driver' && !draft.serverId
      ? defaultPayee(lookups, form.driver_id, form.use_date)
      : form.payee_counterparty_id || defaultPayee(lookups, form.driver_id, form.use_date);
  const displayForm = { ...form, payee_counterparty_id: payee };
  const status =
    draft.phase === 'queued' && draft.intent === 'submit' && !online
      ? '제출 대기 · 연결되면 자동 제출'
      : draft.phase === 'blocked' || draft.phase === 'conflict'
        ? '전송을 멈췄습니다. 안내를 확인하세요'
        : draft.inputError
          ? '입력 내용을 확인하세요'
          : draft.phase === 'saved' && draft.server
            ? draft.server.review_status === 'SUBMITTED'
              ? mode === 'manager'
                ? '검수 대기로 제출 완료'
                : '담당자에게 제출 완료'
              : reviewLabels[draft.server.review_status]
            : draft.savedRequest
              ? '서버 저장(작성중) · 전송 처리 중'
              : localSaved
                ? mode === 'manager'
                  ? '이 기기에 임시저장됨'
                  : '휴대폰에 임시저장됨'
                : mode === 'manager'
                  ? '이 기기에 저장 중…'
                  : '휴대폰에 저장 중…';
  function scrollTo(target: string) {
    const normalized = target.replace(/^use\./, '');
    const candidates = Array.from(document.querySelectorAll<HTMLElement>('[data-fix-target]'));
    const element =
      candidates.find((e) => e.dataset.fixTarget === normalized) ??
      candidates.find((e) => normalized.startsWith(`${e.dataset.fixTarget}.`)) ??
      document.getElementById('form-errors');
    let disclosure = element?.closest('details');
    while (disclosure) {
      disclosure.open = true;
      disclosure = disclosure.parentElement?.closest('details');
    }
    const trip = normalized.match(/^trip:(\d+)/);
    if (trip) window.dispatchEvent(new CustomEvent('vehicle-expand-trip', { detail: Number(trip[1]) - 1 }));
    requestAnimationFrame(() => {
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element?.querySelector<HTMLElement>('input,select,textarea,button')?.focus({ preventScroll: true });
    });
  }
  const options = (
    rows: { id: string; name?: string; plate_no?: string }[],
    selected: string,
    label?: unknown,
  ) => (
    <>
      <option value="">선택하세요</option>
      {selected && !rows.some((r) => r.id === selected) && (
        <option value={selected}>{String(label ?? '기존 선택 (사용 중지)')}</option>
      )}
      {rows.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name ?? r.plate_no}
        </option>
      ))}
    </>
  );
  return (
    <FormContexts fixes={fixes} modes={settings.modes} revealed={revealed}>
      <div className="mx-auto max-w-3xl space-y-5 pb-8">
        <div>
          <p className="text-sm font-semibold text-blue-700">
            {mode === 'manager' ? '담당자 대리 입력' : '내 운행'}
          </p>
          <h1 className="mt-1 text-2xl font-bold">
            {mode === 'manager' ? '대리 입력' : (draft.server?.use_no ?? '운행 등록')}
          </h1>
          <p role="status" className="mt-3 rounded-xl bg-blue-50 p-3 font-semibold text-blue-900">
            {status}
            {!online && ' · 오프라인'}
          </p>
          {draft.server && (
            <p className="mt-3 text-sm">
              작성자: {draft.server.created_by_name ?? draft.server.created_by_user_id} · 실제 기사:{' '}
              {String(draft.server.snapshot.driver_name)} ·{' '}
              {draft.server.entered_as === 'PROXY' ? '대리 입력' : '기사 직접 입력'}
            </p>
          )}
        </div>
        {draft.server?.entered_as === 'PROXY' && mode === 'driver' && (
          <Section title="대리 입력 내용 확인">
            <p className="mb-3 text-sm">
              {draft.server.driver_confirmed_at
                ? '기사가 내용을 확인했습니다.'
                : '담당자가 대신 입력한 운행입니다. 운행 내역을 확인해 주세요.'}
            </p>
            {!draft.server.driver_confirmed_at && (
              <button
                type="button"
                className={button}
                disabled={
                  busy || !online || draft.phase === 'queued' || (!readOnly && draft.phase !== 'saved')
                }
                onClick={async () => {
                  setBusy(true);
                  try {
                    const server = await mutate<UseDetail>(`/api/uses/${draft.serverId}/confirm-by-driver`, {
                      version: draft.server!.version,
                    });
                    const next = {
                      ...draft,
                      server,
                      // Confirmation must not make an older local edit safe to overwrite newer content.
                      version: draft.version === draft.server!.version ? server.version : draft.version,
                    };
                    await putDraft(next);
                    setDraft(next);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : '확인하지 못했습니다.');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                내용 확인
              </button>
            )}
          </Section>
        )}
        {fixes.length > 0 && (
          <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
            <h2 className="font-bold text-amber-900">보완 요청 · 해당 항목으로 이동</h2>
            <ul className="mt-3 grid gap-2">
              {fixes.map((f, i) => (
                <li key={i}>
                  <button
                    type="button"
                    className="min-h-11 text-left font-semibold text-amber-900 underline"
                    onClick={() => scrollTo(f.target)}
                  >
                    {f.message} →
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {(error || draft.error || validation.length > 0) && (
          <div
            id="form-errors"
            role="alert"
            className="scroll-mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800"
          >
            <p>{error || draft.error}</p>
            {validation.map((v, i) => (
              <p key={i}>{v}</p>
            ))}
          </div>
        )}
        {draft.phase === 'blocked' && !readOnly && (
          <p className="rounded-xl bg-amber-50 p-4">
            자동 재전송이 중단되었습니다.{' '}
            {draft.error?.includes('증빙')
              ? '아래 버튼으로 입력을 다시 확인하세요.'
              : '로그인·현장 배정 또는 입력 내용을 확인해 주세요.'}
            <button
              className={`${button} mt-3`}
              type="button"
              onClick={() =>
                setDraft({
                  ...draft,
                  phase: 'editing',
                  request: undefined,
                  submitRequest: undefined,
                  savedRequest: false,
                })
              }
            >
              입력 다시 확인
            </button>
          </p>
        )}
        {draft.phase === 'conflict' && (
          <Section title="다른 수정 내용이 있습니다">
            <p>내 입력을 보관했습니다. 최신 서버 값을 확인한 뒤 다시 저장하세요.</p>
            {draft.conflict ? (
              <>
                <div className="my-4 rounded-xl bg-slate-50 p-4">
                  <p>
                    최신 버전 {draft.conflict.version} · {reviewLabels[draft.conflict.review_status]}
                  </p>
                  <p>
                    {draft.conflict.use_date} · {String(draft.conflict.snapshot.project_name)}
                  </p>
                  <p>운반 내용: {draft.conflict.cargo_desc || '없음'}</p>
                  <p>특이사항: {draft.conflict.notes || '없음'}</p>
                  {draft.conflict.trips.map((t) => (
                    <p key={t.id}>
                      {t.seq}회차 {t.origin} → {t.destination}
                    </p>
                  ))}
                  <p>
                    기본운임{' '}
                    {money(
                      draft.conflict.charge_lines.find(
                        (c) => c.charge_type === 'BASE' && c.direction === 'PAYABLE',
                      )?.computed_amount,
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  className={button}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      phase: 'editing',
                      form: fromUse(draft.conflict!, mode),
                      server: draft.conflict,
                      version: draft.conflict!.version,
                      conflict: undefined,
                      request: undefined,
                      submitRequest: undefined,
                      savedRequest: false,
                      error: undefined,
                    })
                  }
                >
                  최신 값으로 불러와 다시 작성
                </button>
              </>
            ) : (
              <button
                type="button"
                className={button}
                onClick={async () => {
                  try {
                    const conflict = await api<UseDetail>(`/api/uses/${draft.serverId}`);
                    setDraft({ ...draft, conflict });
                  } catch (e) {
                    setError(e instanceof Error ? e.message : '조회 실패');
                  }
                }}
              >
                최신 값 조회
              </button>
            )}
          </Section>
        )}
        {draft.phase === 'queued' && (
          <button
            type="button"
            className={`${button} w-full`}
            disabled={busy}
            onClick={() => {
              void syncQueue(boot.user.id, true);
            }}
          >
            미전송 다시 보내기
          </button>
        )}
        {draft.server?.duplicate_hint && (
          <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
            중복 의심 경고: 같은 출발·도착 운행이 있습니다. 실제 반복 운행이면 그대로 제출할 수 있습니다.
          </p>
        )}
        {mode === 'driver' && draft.server && (
          <div className="space-y-3">
            {statementLocked && (
              <p className="rounded-xl bg-amber-50 p-4">
                정산 확정된 운행입니다. 수정이 필요하면 담당자에게 문의하세요
              </p>
            )}
            {readOnly &&
              !statementLocked &&
              draft.server.operation_status !== 'CANCELED' &&
              (approvalConfirm ? (
                <div
                  role="alertdialog"
                  aria-label="승인 운행 수정 확인"
                  className="rounded-xl bg-amber-50 p-4"
                >
                  <p>수정하면 승인이 해제되고 다시 검수를 받아야 합니다</p>
                  <div className="mt-3 flex gap-2">
                    <button
                      className={primary}
                      onClick={() => {
                        setEditApproved(true);
                        setApprovalConfirm(false);
                      }}
                    >
                      확인 후 수정
                    </button>
                    <button className={button} onClick={() => setApprovalConfirm(false)}>
                      돌아가기
                    </button>
                  </div>
                </div>
              ) : (
                <button className={button} onClick={() => setApprovalConfirm(true)}>
                  수정하기
                </button>
              ))}
            <button
              className={button}
              disabled={busy}
              onClick={async () => {
                try {
                  location.assign(await copyToDevice(boot.user.id, draft.serverId!));
                } catch (e) {
                  setError(e instanceof Error ? e.message : '복사하지 못했습니다.');
                }
              }}
            >
              이전 운행 복사
            </button>
            {draft.server.review_status === 'DRAFT' &&
              !statementLocked &&
              draft.server.operation_status !== 'CANCELED' &&
              (cancelConfirm ? (
                <div
                  role="alertdialog"
                  aria-label="작성중 운행 취소 확인"
                  className="rounded-xl bg-amber-50 p-4"
                >
                  <p>서버에 저장된 작성중 운행을 취소할까요? 운행과 취소 이력은 보존됩니다.</p>
                  <div className="mt-3 flex gap-2">
                    <button
                      className={button}
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await persistence.current;
                          await withQueuePaused(boot.user.id, async () => {
                            await mutate(`/api/uses/${draft.serverId}/cancel`, {
                              version: draft.version,
                              reason: '기사 작성중 운행 취소',
                            });
                            current.current = undefined;
                            await removeDraft(boot.user.id, draft.id);
                          });
                          location.assign('/d');
                        } catch (e) {
                          setError(e instanceof Error ? e.message : '취소하지 못했습니다.');
                          setBusy(false);
                        }
                      }}
                    >
                      운행 취소 확인
                    </button>
                    <button className={button} disabled={busy} onClick={() => setCancelConfirm(false)}>
                      계속 작성
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className={`${button} ml-2 text-red-700`}
                  disabled={locked}
                  onClick={() => setCancelConfirm(true)}
                >
                  작성중 운행 취소
                </button>
              ))}
          </div>
        )}
        {!readOnly && settings.notice && (
          <p className="rounded-xl bg-slate-50 p-3 text-sm">
            {settings.notice}
            {!settings.ready && (
              <button type="button" className={`${button} ml-2`} onClick={settings.retry}>
                다시 확인
              </button>
            )}
          </p>
        )}
        {readOnly ? (
          <ReadOnlyUse use={draft.server!} />
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void enqueue('submit');
            }}
            className="space-y-5"
          >
            <fieldset disabled={locked} className="min-w-0 space-y-5">
              <Section title="사용 정보" target="use">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="사용일" target="use_date">
                    <input
                      className={control}
                      type="date"
                      value={form.use_date}
                      onChange={(e) =>
                        change({
                          use_date: e.target.value,
                          payee_counterparty_id: defaultPayee(lookups, form.driver_id, e.target.value),
                        })
                      }
                    />
                  </Field>
                  <Field label="종료일 (선택)" target="end_date">
                    <input
                      className={control}
                      type="date"
                      value={form.end_date}
                      onChange={(e) => change({ end_date: e.target.value })}
                    />
                  </Field>
                  <Field label="현장" target="project_id">
                    <select
                      className={control}
                      value={form.project_id}
                      onChange={(e) => change({ project_id: e.target.value })}
                    >
                      {options(
                        [...lookups.projects].sort((a, b) => {
                          const ids = boot.recent.rows.map((r) => r.project_id);
                          return (
                            (ids.includes(a.id) ? ids.indexOf(a.id) : 999) -
                            (ids.includes(b.id) ? ids.indexOf(b.id) : 999)
                          );
                        }),
                        form.project_id,
                        draft.server?.snapshot.project_name,
                      )}
                    </select>
                  </Field>
                  {mode === 'manager' && (
                    <Field label="실제 기사" target="driver_id">
                      <select
                        className={control}
                        value={form.driver_id}
                        onChange={(e) => {
                          const driver = lookups.drivers.find((d) => d.id === e.target.value);
                          change({
                            driver_id: e.target.value,
                            vehicle_id: driver?.default_vehicle_id ?? form.vehicle_id,
                            payee_counterparty_id: defaultPayee(lookups, e.target.value, form.use_date),
                          });
                        }}
                      >
                        {options(lookups.drivers, form.driver_id, draft.server?.snapshot.driver_name)}
                      </select>
                    </Field>
                  )}
                  <Field label="차량" target="vehicle_id">
                    <select
                      className={control}
                      value={form.vehicle_id}
                      onChange={(e) => change({ vehicle_id: e.target.value })}
                    >
                      {options(lookups.vehicles, form.vehicle_id, draft.server?.snapshot.plate_no)}
                    </select>
                  </Field>
                  <Field label="지급처" target="payee_counterparty_id">
                    {mode === 'manager' ? (
                      <select
                        className={control}
                        value={
                          form.payee_counterparty_id || defaultPayee(lookups, form.driver_id, form.use_date)
                        }
                        onChange={(e) => change({ payee_counterparty_id: e.target.value })}
                      >
                        {options(
                          lookups.counterparties.filter((c) => c.kind !== 'CUSTOMER'),
                          form.payee_counterparty_id,
                          draft.server?.snapshot.payee_name,
                        )}
                      </select>
                    ) : (
                      <span className="flex min-h-12 items-center rounded-xl bg-slate-50 px-3">
                        {lookups.counterparties.find((c) => c.id === payee)?.name ??
                          String(draft.server?.snapshot.payee_name ?? '사용일의 기사 소속으로 자동 지정')}
                      </span>
                    )}
                  </Field>
                  {mode === 'manager' && (
                    <Field label="고객 (선택)" target="customer_counterparty_id">
                      <select
                        className={control}
                        value={form.customer_counterparty_id}
                        onChange={(e) =>
                          change({
                            customer_counterparty_id: e.target.value,
                            charges: e.target.value
                              ? form.charges.some((c) => c.direction === 'RECEIVABLE')
                                ? form.charges
                                : [...form.charges, newCharge('RECEIVABLE')]
                              : form.charges.filter((c) => c.direction !== 'RECEIVABLE'),
                          })
                        }
                      >
                        {options(
                          lookups.counterparties.filter((c) => c.kind === 'CUSTOMER'),
                          form.customer_counterparty_id,
                          draft.server?.snapshot.customer_name,
                        )}
                      </select>
                    </Field>
                  )}
                  <Field label="공종 (선택)" target="work_type_id">
                    <select
                      className={control}
                      value={form.work_type_id}
                      onChange={(e) => change({ work_type_id: e.target.value })}
                    >
                      {options(lookups.work_types, form.work_type_id)}
                    </select>
                  </Field>
                  <Field label="요청자" target="requester">
                    <input
                      className={control}
                      value={form.requester}
                      onChange={(e) => change({ requester: e.target.value })}
                    />
                  </Field>
                  <Field label="운반 내용" target="cargo_desc">
                    <input
                      className={control}
                      value={form.cargo_desc}
                      onChange={(e) => change({ cargo_desc: e.target.value })}
                    />
                  </Field>
                  <Field
                    label="전체 운행 상태"
                    target="operation_status"
                    hasValue={!!draft.server || form.operation_status !== 'COMPLETED'}
                  >
                    <select
                      className={control}
                      value={form.operation_status}
                      onChange={(e) =>
                        change({ operation_status: e.target.value as FormValues['operation_status'] })
                      }
                    >
                      {Object.entries(operationLabels).map(([v, n]) => (
                        <option key={v} value={v}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </Section>
              <TripFields
                trips={form.trips}
                onChange={(trips) => change({ trips })}
                recent={recent}
                billingUnits={form.charges
                  .filter((charge) => charge.charge_type === 'BASE')
                  .map((charge) => charge.billing_unit)}
              />
              <ChargeFields
                form={displayForm}
                mode={mode}
                onChange={(charges) => change({ charges })}
                userId={boot.user.id}
                saved={draft.server}
              />
              {(settings.modes.notes !== 'HIDDEN' ||
                revealed.has('notes') ||
                form.notes ||
                fixes.some((fix) => ['notes', 'use.notes'].includes(fix.target))) && (
                <Section title="특이사항">
                  <Field label="특이사항" target="notes">
                    <textarea
                      className={control}
                      rows={4}
                      value={form.notes}
                      onChange={(e) => change({ notes: e.target.value })}
                    />
                  </Field>
                </Section>
              )}
            </fieldset>
            <EvidenceEditor
              validationError={evidenceValidation}
              pending={draft.uploads}
              existing={draft.server?.evidence ?? []}
              policy={lookups.projects.find((p) => p.id === form.project_id)?.evidence_policy}
              onChange={(uploads) => edit({ uploads })}
              locked={locked}
              canRemovePending={!busy}
              canRetry={draft.phase === 'queued' && !busy}
              onRemovePending={(id) => {
                void removePending(id);
              }}
              onProcessingChange={setEvidenceBusy}
              onRetry={() => {
                void syncQueue(boot.user.id, true);
              }}
              onDelete={async (id, reason) => {
                await mutate(`/api/evidence/${id}`, { reason }, crypto.randomUUID(), 'DELETE');
                await refresh();
              }}
            />
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                className={button}
                disabled={locked || evidenceBusy}
                onClick={() => {
                  void enqueue('save');
                }}
              >
                서버 저장
              </button>
              <button type="submit" className={primary} disabled={locked || evidenceBusy}>
                {draft.server?.review_status === 'NEEDS_FIX'
                  ? '보완 후 재제출'
                  : mode === 'manager'
                    ? '검수 대기로 제출'
                    : '담당자에게 제출'}
              </button>
            </div>
            <p className="text-sm text-slate-500">
              서버 저장은 작성 중 상태입니다. 제출 버튼을 눌러야 담당자에게 전달됩니다. 오프라인 전송 요청은
              연결되면 자동으로 보냅니다.
            </p>
          </form>
        )}
        {draft.phase !== 'saved' && (
          <section className="rounded-xl border border-slate-200 p-4">
            {discardConfirm ? (
              <div role="alertdialog" aria-label="기기 초안 폐기 확인">
                <p className="font-semibold">이 기기의 초안과 미전송 첨부를 폐기할까요?</p>
                <p className="mt-2 text-sm text-slate-600">
                  복구할 수 없습니다. 이미 서버에 저장된 운행과 증빙은 유지됩니다.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={`${button} text-red-700`}
                    disabled={busy}
                    onClick={() => {
                      void discard();
                    }}
                  >
                    기기 초안 폐기 확인
                  </button>
                  <button
                    type="button"
                    className={button}
                    disabled={busy}
                    onClick={() => setDiscardConfirm(false)}
                  >
                    계속 작성
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className={`${button} text-red-700`}
                disabled={busy}
                onClick={() => setDiscardConfirm(true)}
              >
                {readOnly ? '이 기기의 미전송 초안 폐기' : '기기 초안 폐기'}
              </button>
            )}
          </section>
        )}
        {draft.server && (
          <Section title="검수 결과">
            <StatusBadge warning={draft.server.review_status === 'NEEDS_FIX'}>
              {reviewLabels[draft.server.review_status]}
            </StatusBadge>
            <div className="mt-4 grid gap-3">
              {draft.server.charge_lines.map((c) => (
                <div key={c.id} className="border-t border-slate-100 pt-3">
                  <p>
                    {c.direction === 'RECEIVABLE' ? '고객 청구' : '지급'} ·{' '}
                    {c.charge_type === 'BASE' ? '기본운임' : '추가 비용'} ·{' '}
                    {
                      { PENDING: '검토 중', APPROVED: '승인', HELD: '보류', REJECTED: '반려' }[
                        c.line_review_status
                      ]
                    }
                  </p>
                  <p>
                    요청/계산: {money(c.computed_amount ?? c.requested_amount)} · 인정액:{' '}
                    {c.approved_amount == null ? '미확정' : money(c.approved_amount)}
                  </p>
                  {c.reason && <p className="text-sm">{c.reason}</p>}
                </div>
              ))}
              {draft.server.revisions.map((r) => (
                <p key={r.id} className="text-sm text-slate-600">
                  {r.revision_no}차 제출 ·{' '}
                  {
                    {
                      PENDING: '검수 대기',
                      APPROVED: '승인',
                      NEEDS_FIX: '보완요청',
                      SUPERSEDED: '이전 제출본',
                    }[r.decision]
                  }
                  {r.comment && ` · ${r.comment}`}
                </p>
              ))}
            </div>
          </Section>
        )}
      </div>
    </FormContexts>
  );
}
