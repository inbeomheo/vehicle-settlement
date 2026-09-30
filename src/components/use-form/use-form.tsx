'use client';
import type { RecentRoute } from '@/client/types';
import { proposedAmount } from '@/shared/charge-amount';
import { RestrictedEvidenceNotice } from '@/components/evidence/restricted-notice';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, mutate } from '@/client/api';
import { errorMessage } from '@/client/error-message';
import { useActionLock } from '@/client/use-action-lock';
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
  isUnsent,
  shouldPersistDraft,
  putDraft,
  removeDraft,
  OFFLINE_EVENT,
  type Bootstrap,
  type Draft,
} from '@/client/offline/store';
import { syncQueue, withQueuePaused } from '@/client/offline/engine';
import { reconcileServer } from '@/client/offline/reconcile';
import { copyToDevice } from '@/client/copy-draft';
import { useFormSettings } from './settings';
import { useInlineConfirmation } from './confirmation';
import { revealDraftFields } from './visibility';
import { ReadOnlyUse } from './read-only';
import { evidenceError } from './evidence-policy';
import { EvidenceEditor } from '@/components/evidence/editor';
import { button, control, primary, Field, Section, FormContexts, StatusBadge, ChoiceChips } from './fields';
import { Plate } from '@/components/ui/plate';
import { ChargeFields } from './charges';
import { TripFields } from './trips';
import { ConfirmSubmitSheet, type SubmitSummary } from './confirm-sheet';
import {
  defaultPayee,
  fromUse,
  initialValues,
  newCharge,
  resetBaseRates,
  toInput,
  validateFields,
  type FormError,
  type FormValues,
} from './model';

function navigateAfterSubmit(value: Draft) {
  if (
    value.mode === 'driver' &&
    value.phase === 'saved' &&
    value.intent === 'submit' &&
    value.serverId &&
    value.server &&
    ['SUBMITTED', 'APPROVED'].includes(value.server.review_status)
  )
    location.assign(`/d/uses/${value.serverId}?submitted=1`);
}

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
    const control = element?.querySelector<HTMLElement>(
      'input:not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not(:disabled)',
    );
    (control ?? element)?.focus({ preventScroll: true });
    // Validation navigation must remain visible even after another keyboard focus jump.
    element?.scrollIntoView({ behavior: 'instant', block: 'center' });
  });
}
function scrollToFirstError(errors: FormError[]) {
  const first = Array.from(document.querySelectorAll<HTMLElement>('[data-fix-target]')).find((element) =>
    errors.some((error) => error.target.replace(/^use\./, '') === element.dataset.fixTarget),
  );
  scrollTo(first?.dataset.fixTarget ?? errors[0].target);
}
function normalizedInput(value: unknown) {
  return JSON.stringify(value, (_key, item: unknown) => (typeof item === 'string' ? item.trim() : item));
}

export function UseFormPage({ mode, useId }: { mode: Mode; useId?: string }) {
  const { data, error, authRequired, retry } = useBootstrap(mode);
  if (error)
    return (
      <p role="alert">
        {errorMessage(error)}{' '}
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
  const [recentRoutes, setRecentRoutes] = useState<RecentRoute[]>([]);
  const recentDriver = draft?.form.driver_id;
  useEffect(() => {
    let alive = true;
    setRecentRoutes([]);
    if (!recentDriver) return;
    const key = `recent-routes:${recentDriver}`;
    void api<RecentRoute[]>(`/api/uses/recent-routes?driver_id=${recentDriver}&limit=20`)
      .then(async (rows) => {
        await cacheValue(boot.user.id, key, rows).catch(() => {});
        if (alive) setRecentRoutes(rows);
      })
      .catch(async (error: unknown) => {
        if (error instanceof ApiError) return;
        const rows = await cachedValue<RecentRoute[]>(boot.user.id, key).catch(() => undefined);
        if (alive) setRecentRoutes(rows ?? []);
      });
    return () => {
      alive = false;
    };
  }, [recentDriver, boot.user.id]);
  const [recent, setRecent] = useState<UseDetail[]>([]);
  const [resumable, setResumable] = useState<Draft[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const submitButton = useRef<HTMLButtonElement>(null);
  const [estimates, setEstimates] = useState<Record<string, number | null>>({});
  const reportEstimate = useCallback(
    (key: string, value: number | null) =>
      setEstimates((previous) => (previous[key] === value ? previous : { ...previous, [key]: value })),
    [],
  );
  const [error, setError] = useState('');
  const [validation, setValidation] = useState<FormError[]>([]);
  const [localSaved, setLocalSaved] = useState(false);
  const [localFailed, setLocalFailed] = useState(false);
  const { busy, active: actionActive, start: startAction, finish: finishAction } = useActionLock();
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const [editApproved, setEditApproved] = useState(false);
  const [approvalConfirm, setApprovalConfirm] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const discardConfirmation = useInlineConfirmation(discardConfirm, () => setDiscardConfirm(false), busy);
  const approvalConfirmation = useInlineConfirmation(approvalConfirm, () => setApprovalConfirm(false), busy);
  const cancelConfirmation = useInlineConfirmation(cancelConfirm, () => setCancelConfirm(false), busy);
  const [evidenceValidation, setEvidenceValidation] = useState('');
  const persistence = useRef<Promise<void>>(Promise.resolve());
  const inputErrors = draft?.inputError ? draft.inputErrors : undefined;
  useEffect(() => {
    if (!(error || draft?.error) || inputErrors?.length || validation.length) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById('form-errors')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [error, draft?.error, inputErrors, validation.length]);
  useEffect(() => {
    if (!inputErrors?.length) return;
    const frame = requestAnimationFrame(() => scrollToFirstError(inputErrors));
    return () => cancelAnimationFrame(frame);
  }, [inputErrors]);
  current.current = draft;
  const persist = useCallback(
    async (value: Draft) => {
      await putDraft(value);
      // Reload restores this explicitly addressed draft; a fresh /d/new remains a new form.
      if (!useId && current.current?.id === value.id && !new URLSearchParams(location.search).has('draft')) {
        const url = new URL(location.href);
        url.searchParams.set('draft', value.id);
        history.replaceState(history.state, '', url);
      }
    },
    [useId],
  );
  const queuePersistence = useCallback(
    (value: Draft) => {
      const operation = persistence.current.then(() => persist(value));
      // The tail always settles successfully so one failed write cannot poison later writes.
      // Return the original operation so explicit save/flush callers still see their own failure.
      persistence.current = operation.catch(() => {});
      void operation.then(
        () => {
          if (current.current?.id === value.id && current.current.updatedAt === value.updatedAt) {
            setLocalSaved(true);
            setLocalFailed(false);
          }
        },
        () => {
          setLocalSaved(false);
          setLocalFailed(true);
        },
      );
      return operation;
    },
    [persist],
  );

  useEffect(() => {
    if (draft && settings.ready)
      setDraft((value) =>
        value && value.id === draft.id && value.form.project_id === draft.form.project_id
          ? revealDraftFields(value, settings.modes)
          : value,
      );
  }, [draft, settings.ready, settings.modes]);
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const params = new URLSearchParams(location.search);
        const localId = params.get('draft');
        const stored = await listDrafts(boot.user.id);
        if (alive) setResumable(stored.filter((item) => item.mode === mode && isUnsent(item)));
        let found = localId
          ? await getDraft(boot.user.id, localId)
          : useId || mode === 'manager'
            ? stored.find(
                (d) => d.mode === mode && (useId ? d.serverId === useId : !d.serverId) && d.phase !== 'saved',
              )
            : undefined;
        if (found && (found.mode !== mode || (useId && found.serverId !== useId))) found = undefined;
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
              ? fromUse(
                  server,
                  mode,
                  stored.find((item) => item.serverId === server.id && item.version === server.version)?.form,
                )
              : initialValues(boot.lookups, params.get('project') ?? boot.recent.rows[0]?.project_id),
            uploads: [],
            updatedAt: Date.now(),
            phase: server ? 'saved' : 'editing',
            hasUserInput: !!server,
            server,
            lastSaved: server,
            serverId: server?.id,
            version: server?.version,
          };
        }
        // A local draft must not hide a newer approval or statement lock.
        if (found.serverId && found.phase !== 'saved') {
          try {
            const server = await api<UseDetail>(`/api/uses/${found.serverId}`);
            found = { ...found, lastSaved: found.lastSaved ?? found.server, server };
          } catch (error) {
            if (error instanceof ApiError) throw error;
          }
        }
        if (alive) {
          setDraft(found);
          setLocalSaved(shouldPersistDraft(found));
          if (
            params.get('submitted') === '1' &&
            found.server &&
            ['SUBMITTED', 'APPROVED'].includes(found.server.review_status)
          ) {
            setSubmitted(true);
            window.scrollTo({ top: 0, behavior: 'instant' });
          }
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
        if (alive) setError(errorMessage(e, '불러오지 못했습니다.'));
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, [boot, mode, useId]);
  useEffect(() => {
    if (!draft || draft.phase !== 'editing' || !shouldPersistDraft(draft)) return;
    setLocalSaved(false);
    const timer = window.setTimeout(() => {
      if (!actionActive.current && current.current?.phase === 'editing')
        void queuePersistence(current.current);
    }, 450);
    return () => clearTimeout(timer);
  }, [draft, queuePersistence, actionActive]);
  useEffect(() => {
    const flush = () => {
      if (
        !actionActive.current &&
        current.current?.phase === 'editing' &&
        shouldPersistDraft(current.current)
      )
        return queuePersistence(current.current);
      return persistence.current;
    };
    const flushRequested = (event: Event) => {
      (event as CustomEvent<{ waitUntil: (promise: Promise<void>) => void }>).detail.waitUntil(flush());
    };
    const update = () => {
      const value = current.current;
      if (!value || value.phase !== 'queued') return;
      void getDraft(boot.user.id, value.id)
        .then((next) => {
          if (next && current.current?.phase === 'queued') {
            setLocalSaved(true);
            if (next.phase === 'saved') setEditApproved(false);
            setDraft(
              next.phase === 'saved' && next.server
                ? { ...next, form: fromUse(next.server, mode, next.form) }
                : next,
            );
            if (next.phase === 'saved' && mode === 'manager' && next.serverId)
              location.assign(`/m/uses/${next.serverId}`);
            navigateAfterSubmit(next);
          }
        })
        .catch((error) => setError(errorMessage(error, '휴대폰 저장 내용을 확인하지 못했습니다.')));
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
  }, [boot.user.id, mode, queuePersistence, actionActive]);
  const date = draft?.form.use_date;
  useEffect(() => {
    if (!date) return;
    let alive = true;
    const key = `lookups:${date}`;
    void api<Lookups>(`/api/lookups?use_date=${date}`)
      .then(async (value) => {
        await cacheValue(boot.user.id, key, value).catch(() => {});
        if (alive) setLookups(value);
      })
      .catch(async (e: unknown) => {
        if (e instanceof ApiError) {
          if (alive) setError(e.message);
          return;
        }
        const value = await cachedValue<Lookups>(boot.user.id, key).catch(() => undefined);
        if (alive && value) setLookups(value);
      });
    return () => {
      alive = false;
    };
  }, [date, boot.user.id]);
  function edit(patch: Partial<Draft> | ((value: Draft) => Partial<Draft>)) {
    if (actionActive.current) return;
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
        inputErrors: undefined,
      };
    });
    setValidation([]);
    setEvidenceValidation('');
  }

  function change(patch: Partial<FormValues>, automatic = false) {
    const rateContextChanged = [
      'driver_id',
      'vehicle_id',
      'use_date',
      'project_id',
      'payee_counterparty_id',
      'customer_counterparty_id',
    ].some((key) => key in patch && patch[key as keyof FormValues] !== draft?.form[key as keyof FormValues]);
    edit((value) => ({
      hasUserInput:
        value.hasUserInput !== false ||
        (!automatic &&
          Object.entries(patch).some(([key, next]) =>
            typeof next === 'string'
              ? !!next.trim() && next !== value.form[key as keyof FormValues]
              : normalizedInput(next) !== normalizedInput(value.form[key as keyof FormValues]),
          )),
      form: {
        ...value.form,
        ...patch,
        ...(rateContextChanged ? { charges: resetBaseRates(patch.charges ?? value.form.charges) } : {}),
      },
    }));
  }
  async function enqueue(intent: 'save' | 'submit', confirmed = false) {
    if (confirmed) setConfirmOpen(false);
    if (!draft || busy || evidenceBusy || activeUser() !== boot.user.id) return;
    if (
      draft.server?.is_locked ||
      (mode === 'driver' && draft.server?.review_status === 'APPROVED' && !editApproved)
    )
      return;
    if (!settings.ready) return;
    if (!startAction()) return;
    setError('');
    try {
      const modes = intent === 'submit' ? await settings.refresh() : settings.modes;
      const errors = validateFields(draft.form, intent, modes);
      const missingEvidence =
        intent === 'submit'
          ? evidenceError(
              lookups.projects.find((p) => p.id === draft.form.project_id)?.evidence_policy,
              draft.server?.evidence ?? [],
              draft.uploads,
              draft.server?.project_id === draft.form.project_id &&
                draft.server?.restricted_evidence_satisfies_policy,
            )
          : '';
      setEvidenceValidation(missingEvidence);
      if (missingEvidence) errors.push({ target: 'evidence', reason: missingEvidence });
      setValidation(errors);
      if (errors.length) {
        requestAnimationFrame(() => scrollToFirstError(errors));
        return;
      }
      // 기사는 보내기 전에 요약을 한 번 더 확인한다.
      if (intent === 'submit' && mode === 'driver' && !confirmed) {
        setConfirmOpen(true);
        return;
      }
      const queued: Draft = {
        ...draft,
        hasUserInput: true,
        intent,
        inputError: false,
        inputErrors: undefined,
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
      await queuePersistence(queued);
      setLocalFailed(false);
      setDraft(queued);
      current.current = queued;
      await syncQueue(boot.user.id);
      const result = await getDraft(boot.user.id, queued.id);
      if (result) {
        setLocalSaved(true);
        if (result.phase === 'saved') setEditApproved(false);
        setDraft(
          result.phase === 'saved' && result.server
            ? { ...result, form: fromUse(result.server, mode, result.form) }
            : result,
        );
        if (result.phase === 'saved' && mode === 'manager') location.assign(`/m/uses/${result.serverId}`);
        navigateAfterSubmit(result);
      }
    } catch (e) {
      setError(errorMessage(e, '저장하지 못했습니다.'));
    } finally {
      finishAction();
    }
  }
  async function deleteStoredEvidence(id: string, reason: string) {
    if (!draft?.serverId) return;
    const next = structuredClone(draft);
    try {
      reconcileServer(next, await api<UseDetail>(`/api/uses/${draft.serverId}`));
      await mutate(`/api/evidence/${id}`, { reason }, crypto.randomUUID(), 'DELETE');
      next.removedEvidenceIds = [...(next.removedEvidenceIds ?? []), id];
      await putDraft(next);
      reconcileServer(next, await api<UseDetail>(`/api/uses/${draft.serverId}`));
    } catch (error) {
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
        next.phase = 'conflict';
        next.error = error.message;
      }
      await putDraft(next);
      setDraft(next);
      throw error;
    }
    await putDraft(next);
    setDraft(next);
  }
  async function removePending(uploadId: string) {
    if (!draft || busy) return;
    if (!startAction()) return;
    setError('');
    try {
      await persistence.current;
      const next = await withQueuePaused(boot.user.id, async () => {
        const value = draft.phase === 'editing' ? draft : ((await getDraft(boot.user.id, draft.id)) ?? draft);
        const file = value.uploads.find((upload) => upload.client_upload_id === uploadId);
        if (!file || file.status === 'uploaded') return value;
        if (file.serverId) {
          try {
            reconcileServer(value, await api<UseDetail>(`/api/uses/${value.serverId}`));
            await mutate(
              `/api/evidence/${file.serverId}`,
              { reason: '업로드 실패 첨부 취소' },
              crypto.randomUUID(),
              'DELETE',
            );
            value.removedEvidenceIds = [...(value.removedEvidenceIds ?? []), file.serverId];
          } catch (e) {
            if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') {
              const conflict = { ...value, phase: 'conflict' as const, error: e.message };
              await putDraft(conflict);
              return conflict;
            }
            setError(
              `이 기기의 대기 첨부는 제거했습니다. 서버 증빙: ${errorMessage(e, '삭제하지 못했습니다.')}`,
            );
          }
        }
        let server = value.server;
        if (value.serverId) {
          try {
            server = await api<UseDetail>(`/api/uses/${value.serverId}`);
            reconcileServer(value, server);
          } catch (e) {
            if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') {
              const conflict = { ...value, phase: 'conflict' as const, error: e.message };
              await putDraft(conflict);
              return conflict;
            }
            // Local queue cancellation is available even after access is revoked.
          }
        }
        const updated: Draft = {
          ...value,
          server,
          version: value.version,
          pendingCreate:
            value.pendingCreate ??
            (value.phase === 'queued' && !value.serverId && value.request && !value.savedRequest
              ? { request: structuredClone(value.request), form: structuredClone(value.form) }
              : undefined),
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
      setError(errorMessage(e, '첨부를 제거하지 못했습니다.'));
    } finally {
      finishAction();
    }
  }
  async function discard() {
    if (!draft || busy) return;
    const value = draft;
    if (!startAction()) return;
    setDraft(undefined);
    current.current = undefined;
    try {
      await persistence.current;
      await withQueuePaused(boot.user.id, () => removeDraft(boot.user.id, value.id));
      location.assign(mode === 'driver' ? '/d' : '/m/ledger');
    } catch (e) {
      setDraft(value);
      setError(errorMessage(e, '기기 초안을 폐기하지 못했습니다.'));
    } finally {
      finishAction();
    }
  }
  async function retryLocalSave() {
    const value = current.current;
    if (!value || !startAction()) return;
    setError('');
    try {
      await queuePersistence(value);
    } catch (e) {
      setError(errorMessage(e, '휴대폰에 저장하지 못했습니다. 다시 시도해 주세요.'));
    } finally {
      finishAction();
    }
  }
  async function retryQueue() {
    if (!startAction()) return;
    setError('');
    try {
      await syncQueue(boot.user.id, true);
    } catch (e) {
      setError(errorMessage(e, '전송하지 못했습니다. 다시 시도해 주세요.'));
    } finally {
      finishAction();
    }
  }
  if (!draft)
    return (
      <p role={error ? 'alert' : 'status'}>
        {error ? errorMessage(error) : '기기 초안을 확인하고 있습니다…'}
      </p>
    );
  const form = draft.form;
  const fieldErrors = [...validation, ...(inputErrors ?? [])];
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
  // 기사가 무언가 해야 하는 상태는 주황으로 눈에 띄게 한다.
  const statusWarning =
    draft.phase === 'blocked' ||
    draft.phase === 'conflict' ||
    !!draft.inputError ||
    (draft.phase === 'saved' && draft.server?.review_status === 'NEEDS_FIX');
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
                : '담당자에게 보냈습니다'
              : reviewLabels[draft.server.review_status]
            : draft.savedRequest
              ? '작성 중 · 아직 안 보냄 · 보내는 중'
              : !shouldPersistDraft(draft)
                ? '새 운행을 작성하세요'
                : localSaved
                  ? mode === 'manager'
                    ? '이 기기에 임시저장됨'
                    : '휴대폰에만 저장됨'
                  : mode === 'manager'
                    ? '이 기기에 저장 중…'
                    : '휴대폰에 저장 중…';
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
  const recentProjectIds = boot.recent.rows.map((r) => r.project_id);
  const sortedProjects = [...lookups.projects].sort(
    (a, b) =>
      (recentProjectIds.includes(a.id) ? recentProjectIds.indexOf(a.id) : 999) -
      (recentProjectIds.includes(b.id) ? recentProjectIds.indexOf(b.id) : 999),
  );
  // 기사 화면은 고를 것이 몇 개뿐이면 드롭다운 대신 한 번 누르는 칩으로 보여 준다.
  const chipProjects =
    mode === 'driver' &&
    sortedProjects.length > 0 &&
    sortedProjects.length <= 4 &&
    (!form.project_id || sortedProjects.some((p) => p.id === form.project_id));
  const defaultVehicle = lookups.drivers.find((d) => d.id === form.driver_id)?.default_vehicle_id;
  const vehicleChoices = [...lookups.vehicles].sort(
    (a, b) => Number(b.id === defaultVehicle) - Number(a.id === defaultVehicle),
  );
  const chipVehicles =
    mode === 'driver' &&
    vehicleChoices.length > 0 &&
    vehicleChoices.length <= 4 &&
    (!form.vehicle_id || vehicleChoices.some((v) => v.id === form.vehicle_id));
  const policy = lookups.projects.find((p) => p.id === form.project_id)?.evidence_policy;
  const pendingUploads = draft.uploads;
  const shownServerEvidence = (draft.server?.evidence ?? []).filter(
    (f) => !pendingUploads.some((u) => u.serverId === f.id || u.replacesId === f.id),
  );
  const baseCharges = form.charges.filter((c) => c.direction === 'PAYABLE' && c.charge_type === 'BASE');
  const baseAmounts = baseCharges.map((c) =>
    c.requested_amount !== '' ? Number(c.requested_amount) : estimates[c.key],
  );
  const extraAmount = form.charges
    .filter(
      (c) =>
        c.direction === 'PAYABLE' &&
        c.charge_type !== 'BASE' &&
        !c.included_in_base &&
        /^\d+$/.test(c.requested_amount),
    )
    .reduce((sum, c) => sum + Number(c.requested_amount), 0);
  const stepDone = {
    site: !!form.use_date && !!form.project_id,
    vehicle: !!form.vehicle_id,
    trips: form.trips.length > 0 && form.trips.every((t) => t.origin.trim() && t.destination.trim()),
    evidence: !evidenceError(
      policy,
      draft.server?.evidence ?? [],
      pendingUploads,
      draft.server?.project_id === form.project_id && draft.server?.restricted_evidence_satisfies_policy,
    ),
    fee: baseCharges.length > 0 && baseAmounts.every((value) => typeof value === 'number'),
  };
  const firstTrip = form.trips[0];
  const summary: SubmitSummary = {
    date: form.use_date,
    project: lookups.projects.find((p) => p.id === form.project_id)?.name ?? '',
    plate:
      lookups.vehicles.find((v) => v.id === form.vehicle_id)?.plate_no ??
      String(draft.server?.snapshot.plate_no ?? ''),
    route: firstTrip
      ? `${firstTrip.origin || '출발 미입력'} → ${firstTrip.destination || '도착 미입력'}${form.trips.length > 1 ? ` 외 ${form.trips.length - 1}회` : ''}`
      : '',
    evidenceCount: shownServerEvidence.length + pendingUploads.length,
    amount: stepDone.fee
      ? (baseAmounts as number[]).reduce((sum, value) => sum + value, 0) + extraAmount
      : null,
  };
  const dateFields = (
    <>
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
      <Field label="현장" target="project_id" group={chipProjects}>
        {chipProjects ? (
          <ChoiceChips
            name="project_id"
            value={form.project_id}
            onChange={(project_id) => change({ project_id })}
            choices={sortedProjects.map((p) => ({ value: p.id, name: p.name, label: p.name }))}
          />
        ) : (
          <select
            className={control}
            value={form.project_id}
            onChange={(e) => change({ project_id: e.target.value })}
          >
            {options(sortedProjects, form.project_id, draft.server?.snapshot.project_name)}
          </select>
        )}
      </Field>
    </>
  );
  const vehicleFields = (
    <>
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
      <Field label="차량" target="vehicle_id" group={chipVehicles}>
        {chipVehicles ? (
          <ChoiceChips
            name="vehicle_id"
            value={form.vehicle_id}
            onChange={(vehicle_id) => change({ vehicle_id })}
            choices={vehicleChoices.map((v) => ({
              value: v.id,
              name: v.plate_no,
              label: <Plate value={v.plate_no} size="sm" />,
            }))}
          />
        ) : (
          <select
            className={control}
            value={form.vehicle_id}
            onChange={(e) => change({ vehicle_id: e.target.value })}
          >
            {options(lookups.vehicles, form.vehicle_id, draft.server?.snapshot.plate_no)}
          </select>
        )}
      </Field>
      <Field label="지급처" target="payee_counterparty_id">
        {mode === 'manager' ? (
          <select
            className={control}
            value={form.payee_counterparty_id || defaultPayee(lookups, form.driver_id, form.use_date)}
            onChange={(e) => change({ payee_counterparty_id: e.target.value })}
          >
            {options(
              lookups.counterparties.filter((c) => c.kind !== 'CUSTOMER'),
              form.payee_counterparty_id,
              draft.server?.snapshot.payee_name,
            )}
          </select>
        ) : (
          <span className="flex min-h-12 items-center rounded-lg bg-slate-50 px-3 text-slate-700">
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
    </>
  );
  const extraUseFields = (
    <>
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
        hasValue={form.operation_status !== 'COMPLETED'}
      >
        <select
          className={control}
          value={form.operation_status}
          onChange={(e) => change({ operation_status: e.target.value as FormValues['operation_status'] })}
        >
          {Object.entries(operationLabels).map(([v, n]) => (
            <option key={v} value={v}>
              {n}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
  return (
    <FormContexts fixes={fixes} modes={settings.modes} revealed={revealed} errors={fieldErrors}>
      <div className="mx-auto max-w-3xl space-y-5 pb-8">
        {submitted && (
          <section
            aria-labelledby="submit-success-title"
            className="rounded-2xl border-2 border-emerald-600 bg-emerald-50 px-5 py-6 text-center"
          >
            <span
              aria-hidden="true"
              className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-700 text-white"
            >
              <svg
                width="36"
                height="36"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m5 12 5 5 9-10" />
              </svg>
            </span>
            <h2 id="submit-success-title" className="mt-3 text-[1.625rem] font-bold text-emerald-900">
              보냈습니다
            </h2>
            <p className="mt-1 text-lg text-emerald-900">담당자가 확인하면 내 운행에서 볼 수 있습니다.</p>
            <a href="/d" className={`${primary} mt-5 min-h-16 w-full text-xl`}>
              내 운행으로
            </a>
          </section>
        )}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-[1.625rem] font-bold">
              {mode === 'manager' ? '대리 입력' : (draft.server?.use_no ?? '운행 등록')}
            </h1>
            <p
              role="status"
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold before:h-2 before:w-2 before:rounded-full ${online && !statusWarning ? 'border-slate-300 bg-white text-slate-700 before:bg-blue-700' : 'border-orange-300 bg-orange-50 text-orange-900 before:bg-orange-600'}`}
            >
              {status}
              {!online && ' · 오프라인'}
            </p>
          </div>
          {draft.server && (
            <p className="mt-3 text-sm">
              작성자: {draft.server.created_by_name ?? draft.server.created_by_user_id} · 실제 기사:{' '}
              {String(draft.server.snapshot.driver_name)} ·{' '}
              {draft.server.entered_as === 'PROXY' ? '대리 입력' : '기사 직접 입력'}
            </p>
          )}
        </div>
        {mode === 'driver' && !useId && resumable.some((item) => item.id !== draft.id) && (
          <details className="rounded-lg border border-blue-200 bg-blue-50 p-4">
            <summary className="min-h-11 cursor-pointer py-2 font-semibold text-blue-900">
              작성 중이던 운행 {resumable.filter((item) => item.id !== draft.id).length}건 이어서 쓰기
            </summary>
            <ul className="mt-2 grid gap-2">
              {resumable
                .filter((item) => item.id !== draft.id)
                .map((item) => (
                  <li key={item.id}>
                    <a
                      className={`${button} w-full justify-start`}
                      href={`${item.serverId ? `/d/uses/${item.serverId}` : '/d/new'}?draft=${item.id}`}
                    >
                      {item.form.use_date} ·{' '}
                      {lookups.projects.find((project) => project.id === item.form.project_id)?.name ??
                        '현장 선택 전'}{' '}
                      · {item.form.trips[0]?.origin || '출발 입력 전'}
                    </a>
                  </li>
                ))}
            </ul>
          </details>
        )}
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
                  if (!startAction()) return;
                  setError('');
                  try {
                    const server = await mutate<UseDetail>(`/api/uses/${draft.serverId}/confirm-by-driver`, {
                      version: draft.server!.version,
                    });
                    const next = {
                      ...draft,
                      server,
                      // Confirmation must not make an older local edit safe to overwrite newer content.
                      version: draft.version === draft.server!.version ? server.version : draft.version,
                      lastSaved: draft.version === draft.server!.version ? server : draft.lastSaved,
                    };
                    await putDraft(next);
                    setDraft(next);
                  } catch (e) {
                    setError(errorMessage(e, '확인하지 못했습니다.'));
                  } finally {
                    finishAction();
                  }
                }}
              >
                내용 확인
              </button>
            )}
          </Section>
        )}
        {fixes.length > 0 && (
          <section className="rounded-lg border border-l-4 border-orange-300 border-l-orange-500 bg-orange-50 p-4">
            <h2 className="font-bold text-orange-900">보완 요청 · 해당 항목으로 이동</h2>
            <ul className="mt-3 grid gap-2">
              {fixes.map((f, i) => (
                <li key={i}>
                  <button
                    type="button"
                    className="min-h-11 text-left font-semibold text-orange-900 underline"
                    onClick={() => scrollTo(f.target)}
                  >
                    {f.message} →
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {(error || draft.error || localFailed || fieldErrors.length > 0) && (
          <div
            id="form-errors"
            role="alert"
            tabIndex={-1}
            className="scroll-mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800"
          >
            {(error || draft.error) && <p>{errorMessage(error || draft.error)}</p>}
            {localFailed && (
              <button
                type="button"
                className={`${button} mt-2`}
                disabled={busy}
                onClick={() => {
                  void retryLocalSave();
                }}
              >
                휴대폰 저장 실패 — 다시 시도
              </button>
            )}
            {fieldErrors.map((v, i) => (
              <p key={i}>
                <button
                  type="button"
                  className="min-h-11 text-left underline"
                  onClick={() => scrollTo(v.target)}
                >
                  {v.reason}
                </button>
              </p>
            ))}
          </div>
        )}
        {draft.phase === 'blocked' && !readOnly && (
          <p className="rounded-lg bg-amber-50 p-4">
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
                <div className="my-4 rounded-lg bg-slate-50 p-4">
                  <p>
                    최신 버전 {draft.conflict.version} · {reviewLabels[draft.conflict.review_status]}
                  </p>
                  <p>
                    {draft.conflict.use_date} · {String(draft.conflict.snapshot.project_name)}
                  </p>
                  <p>운반 내용: {draft.conflict.cargo_desc || '없음'}</p>
                  <p>특이사항: {draft.conflict.notes || '없음'}</p>
                  {draft.conflict.charge_lines
                    .filter((line) => line.charge_type === 'BASE')
                    .map((line) => (
                      <p key={line.id}>청구수량: {line.quantity ?? '미입력'}</p>
                    ))}
                  {draft.conflict.trips.map((t) => (
                    <p key={t.id}>
                      {t.seq}회차 {t.origin} → {t.destination}
                    </p>
                  ))}
                  <p>
                    기본운임{' '}
                    {money(
                      proposedAmount(
                        draft.conflict.charge_lines.find(
                          (c) => c.charge_type === 'BASE' && c.direction === 'PAYABLE',
                        ),
                      ),
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
                      lastSaved: draft.conflict,
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
                disabled={busy}
                onClick={async () => {
                  if (!startAction()) return;
                  setError('');
                  try {
                    const conflict = await api<UseDetail>(`/api/uses/${draft.serverId}`);
                    setDraft({ ...draft, conflict });
                  } catch (e) {
                    setError(errorMessage(e, '조회 실패'));
                  } finally {
                    finishAction();
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
              void retryQueue();
            }}
          >
            미전송 다시 보내기
          </button>
        )}
        {draft.server?.duplicate_hint && (
          <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
            중복 의심 경고: 같은 출발·도착 운행이 있습니다. 실제 반복 운행이면 그대로 제출할 수 있습니다.
          </p>
        )}
        {mode === 'driver' && draft.server && (
          <div className="space-y-3">
            {statementLocked && (
              <p className="rounded-lg bg-amber-50 p-4">
                정산 확정된 운행입니다. 수정이 필요하면 담당자에게 문의하세요
              </p>
            )}
            {readOnly &&
              !statementLocked &&
              draft.server.operation_status !== 'CANCELED' &&
              (approvalConfirm ? (
                <div
                  {...approvalConfirmation.dialog}
                  role="alertdialog"
                  aria-label="승인 운행 수정 확인"
                  className="rounded-lg bg-amber-50 p-4"
                >
                  <p>수정하면 승인이 해제되고 다시 검수를 받아야 합니다</p>
                  <div className="mt-3 flex gap-2">
                    <button
                      className={primary}
                      onClick={() => {
                        setEditApproved(true);
                        setApprovalConfirm(false);
                        requestAnimationFrame(() => scrollTo('use_date'));
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
                <button
                  ref={approvalConfirmation.trigger}
                  className={button}
                  disabled={busy}
                  onClick={() => setApprovalConfirm(true)}
                >
                  수정하기
                </button>
              ))}
            {draft.server.review_status === 'DRAFT' &&
              !statementLocked &&
              draft.server.operation_status !== 'CANCELED' &&
              (cancelConfirm ? (
                <div
                  {...cancelConfirmation.dialog}
                  role="alertdialog"
                  aria-label="작성중 운행 취소 확인"
                  className="rounded-lg bg-amber-50 p-4"
                >
                  <p>서버에 저장된 작성중 운행을 취소할까요? 운행과 취소 이력은 보존됩니다.</p>
                  <div className="mt-3 flex gap-2">
                    <button
                      className={button}
                      disabled={busy}
                      onClick={async () => {
                        if (!startAction()) return;
                        setError('');
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
                          setError(errorMessage(e, '취소하지 못했습니다.'));
                          finishAction();
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
                  ref={cancelConfirmation.trigger}
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
          <p className="rounded-lg bg-slate-50 p-3 text-sm">
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
              {mode === 'driver' ? (
                <>
                  <Section title="현장·날짜" target="use" step={1} done={stepDone.site}>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {dateFields}
                      {extraUseFields}
                    </div>
                  </Section>
                  <Section title="차량" step={2} done={stepDone.vehicle}>
                    <div className="grid gap-4">{vehicleFields}</div>
                  </Section>
                </>
              ) : (
                <Section title="운행 정보" target="use">
                  <div className="grid gap-4 sm:grid-cols-2">
                    {dateFields}
                    {vehicleFields}
                    {extraUseFields}
                  </div>
                </Section>
              )}
              <TripFields
                step={mode === 'driver' ? 3 : undefined}
                done={stepDone.trips}
                trips={form.trips}
                onChange={(trips) => change({ trips })}
                recent={recent.filter((use) => use.driver_id === form.driver_id)}
                recentRoutes={recentRoutes}
                onRecentRoute={(trips, route) =>
                  change({
                    trips,
                    charges: form.charges.map((charge) =>
                      charge.charge_type === 'BASE' &&
                      charge.direction === 'PAYABLE' &&
                      charge.requested_amount === ''
                        ? {
                            ...charge,
                            recentAmount:
                              route.last_amount === null
                                ? undefined
                                : { amount: route.last_amount, tax_mode: 'VAT_EXCLUDED' },
                          }
                        : charge,
                    ),
                  })
                }
                billingUnits={form.charges
                  .filter((charge) => charge.charge_type === 'BASE')
                  .map((charge) => charge.billing_unit)}
              />
            </fieldset>
            <RestrictedEvidenceNotice count={draft.server?.restricted_evidence_count} />
            <EvidenceEditor
              step={mode === 'driver' ? 4 : undefined}
              done={stepDone.evidence}
              validationError={
                evidenceValidation || inputErrors?.find((error) => error.target === 'evidence')?.reason
              }
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
                void retryQueue();
              }}
              onDelete={deleteStoredEvidence}
            />
            <fieldset disabled={locked} className="min-w-0 space-y-5">
              <ChargeFields
                step={mode === 'driver' ? 5 : undefined}
                done={stepDone.fee}
                onEstimate={reportEstimate}
                form={displayForm}
                mode={mode}
                onChange={(charges, automatic) => change({ charges }, automatic)}
                userId={boot.user.id}
                saved={draft.server}
              />
              {(settings.modes.notes !== 'HIDDEN' ||
                revealed.has('notes') ||
                fieldErrors.some((error) => error.target === 'notes') ||
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
            <div
              className={`sticky z-10 -mx-4 border-t border-slate-200 bg-concrete/95 px-4 pt-3 backdrop-blur ${mode === 'driver' ? 'bottom-[calc(3.8rem+env(safe-area-inset-bottom))] pb-3' : 'bottom-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]'}`}
            >
              <div className="flex gap-2">
                <button
                  type="button"
                  aria-label="서버 저장"
                  className={`${button} min-h-14 shrink-0 px-5`}
                  disabled={locked || evidenceBusy}
                  onClick={() => {
                    void enqueue('save');
                  }}
                >
                  저장
                </button>
                <button
                  ref={submitButton}
                  type="submit"
                  className={`${primary} min-h-14 flex-1 text-lg`}
                  disabled={locked || evidenceBusy}
                >
                  {draft.server?.review_status === 'NEEDS_FIX'
                    ? '고쳐서 다시 보내기'
                    : draft.server?.review_status === 'SUBMITTED' && mode === 'driver'
                      ? '수정해서 다시 보내기'
                      : mode === 'manager'
                        ? '검수 대기로 제출'
                        : '담당자에게 보내기'}
                </button>
              </div>
            </div>
          </form>
        )}
        {confirmOpen && (
          <ConfirmSubmitSheet
            summary={summary}
            busy={busy}
            onConfirm={() => void enqueue('submit', true)}
            onClose={() => setConfirmOpen(false)}
            returnFocus={submitButton}
          />
        )}
        {draft.phase !== 'saved' && (
          <section className="rounded-lg border border-slate-200 p-4">
            {discardConfirm ? (
              <div {...discardConfirmation.dialog} role="alertdialog" aria-label="기기 초안 폐기 확인">
                <p className="font-semibold">이 기기의 초안과 미전송 첨부를 폐기할까요?</p>
                <p className="mt-2 text-[0.9375rem] text-slate-700">
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
                ref={discardConfirmation.trigger}
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
                    요청/계산: {money(proposedAmount(c))} · 인정액:{' '}
                    {c.approved_amount == null ? '미확정' : money(c.approved_amount)}
                  </p>
                  {c.reason && <p className="text-sm">{c.reason}</p>}
                </div>
              ))}
              {draft.server.revisions.map((r) => (
                <p key={r.id} className="text-[0.9375rem] text-slate-700">
                  {r.revision_no}차 제출 ·{' '}
                  {
                    {
                      PENDING: '검수 대기',
                      APPROVED: '승인됨',
                      NEEDS_FIX: '고쳐 달라는 요청',
                      SUPERSEDED: '이전에 보낸 내용',
                    }[r.decision]
                  }
                  {r.comment && ` · ${r.comment}`}
                </p>
              ))}
            </div>
          </Section>
        )}
        {mode === 'driver' && draft.server && (
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
            <button
              className={button}
              disabled={busy}
              onClick={async () => {
                if (!startAction()) return;
                setError('');
                try {
                  location.assign(await copyToDevice(boot.user.id, draft.serverId!));
                } catch (e) {
                  setError(errorMessage(e, '복사하지 못했습니다.'));
                  finishAction();
                }
              }}
            >
              이전 운행 복사
            </button>
            <p className="text-[0.9375rem] text-slate-700">비슷한 운행은 복사해서 새로 쓸 수 있습니다.</p>
          </div>
        )}
      </div>
    </FormContexts>
  );
}
