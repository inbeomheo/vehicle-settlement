import { ApiError, api, mutate, upload } from '../api';
import type { UseDetail, User } from '../types';
import { activeUser, listDrafts, putDraft, type Draft } from './store';
import { fromUse, toInput } from '../../components/use-form/model';
import { bindCreatedRows } from './create-recovery';
import { reconcileServer, rememberServer } from './reconcile';

export type Transport = {
  get: typeof api;
  mutate: typeof mutate;
  upload: typeof upload;
  isActive: (id: string) => boolean;
};
const transport: Transport = { get: api, mutate, upload, isActive: (id) => activeUser() === id };
const stopStatuses = [401, 403, 404];
const permanentClientError = (error: unknown): error is ApiError =>
  error instanceof ApiError &&
  error.status >= 400 &&
  error.status < 500 &&
  ![408, 429].includes(error.status);
// Every successful step is persisted before starting the next. The request body/key
// stays immutable across ambiguous failures, including PATCH and final submission.
export async function sendDraft(
  draft: Draft,
  persist: (draft: Draft) => Promise<void>,
  io: Transport = transport,
) {
  if (draft.phase !== 'queued') return draft;
  const save = () => persist(structuredClone(draft));
  const assertOwner = () => {
    if (!io.isActive(draft.userId))
      throw new ApiError(401, 'ACCOUNT_CHANGED', '전송 계정이 변경되어 재전송을 중단했습니다.');
  };
  try {
    assertOwner();
    const user = await io.get<User>('/api/me');
    if (user.id !== draft.userId)
      throw new ApiError(401, 'ACCOUNT_CHANGED', '다른 계정으로 로그인되어 재전송을 중단했습니다.');
    if (!draft.serverId && draft.request && !draft.savedRequest) {
      draft.pendingCreate ??= {
        request: structuredClone(draft.request),
        form: structuredClone(draft.form),
      };
      await save();
      assertOwner();
      const original = draft.pendingCreate;
      const result = await io.mutate<UseDetail>(
        '/api/uses',
        original.request.payload,
        original.request.key,
        'POST',
      );
      draft.serverId = result.id;
      rememberServer(draft, result);
      if (draft.request.key !== original.request.key) {
        draft.form = bindCreatedRows(draft.form, original.form, result);
        draft.request = {
          key: crypto.randomUUID(),
          payload: { ...toInput(draft.form, draft.mode), version: result.version },
        };
      } else draft.savedRequest = true;
      draft.pendingCreate = undefined;
      await save();
    }
    if (!draft.savedRequest && draft.request) {
      assertOwner();
      const result = await io.mutate<UseDetail>(
        draft.serverId ? `/api/uses/${draft.serverId}` : '/api/uses',
        draft.request.payload,
        draft.request.key,
        draft.serverId ? 'PATCH' : 'POST',
      );
      draft.serverId = result.id;
      rememberServer(draft, result);
      draft.savedRequest = true;
      await save();
    }
    if (!draft.serverId) throw new Error('전송할 사용 건이 없습니다. 입력 내용을 확인하세요.');
    if (!draft.submitRequest) {
      assertOwner();
      reconcileServer(draft, await io.get<UseDetail>(`/api/uses/${draft.serverId}`));
      await save();
      for (const file of draft.uploads) {
        if (file.status === 'uploaded') continue;
        try {
          assertOwner();
          file.status = 'uploading';
          file.error = undefined;
          file.progress = 0;
          await save();
          if (!file.serverId) {
            const meta = {
              client_upload_id: file.client_upload_id,
              kind: file.kind,
              ...(file.blob
                ? { original_name: file.original_name, mime: file.blob.type, size: file.blob.size }
                : { text_value: file.text_value }),
            };
            const path = file.replacesId
              ? `/api/evidence/${file.replacesId}/replace`
              : `/api/uses/${draft.serverId}/evidence`;
            const body = file.replacesId ? { reason: file.reason, evidence: meta } : meta;
            const result = await io.mutate<{ id: string }>(path, body, `evidence-${file.client_upload_id}`);
            file.serverId = result.id;
            await save();
          }
          if (file.blob) {
            assertOwner();
            await io.upload(`/api/evidence/${file.serverId}/content`, file.blob, (value) => {
              // Progress is cosmetic; durable status changes are awaited below.
              if (typeof window !== 'undefined')
                window.dispatchEvent(
                  new CustomEvent('vehicle-upload-progress', {
                    detail: { draftId: draft.id, uploadId: file.client_upload_id, value },
                  }),
                );
            });
          }
          file.status = 'uploaded';
          file.progress = 100;
          await save();
        } catch (error) {
          file.status = 'failed';
          file.error = error instanceof Error ? error.message : '업로드 실패';
          await save();
          if (permanentClientError(error)) throw error;
        }
      }
      assertOwner();
      reconcileServer(draft, await io.get<UseDetail>(`/api/uses/${draft.serverId}`));
      await save();
      if (draft.uploads.some((f) => f.status !== 'uploaded')) {
        draft.error = '사용 건은 서버에 저장되었습니다. 사진 업로드 실패: 사진만 다시 보냅니다.';
        await save();
        return draft;
      }
      if (draft.intent === 'submit' && !['SUBMITTED', 'APPROVED'].includes(draft.server!.review_status)) {
        if (!draft.submitRequest) {
          draft.submitRequest = { key: crypto.randomUUID(), version: draft.version! };
          await save();
        }
      }
    }
    if (draft.submitRequest) {
      assertOwner();
      await io.mutate<UseDetail>(
        `/api/uses/${draft.serverId}/submit`,
        { version: draft.submitRequest.version },
        draft.submitRequest.key,
      );
      // A replay is a historical receipt, not the current review decision.
      assertOwner();
      rememberServer(draft, await io.get<UseDetail>(`/api/uses/${draft.serverId}`));
    }
    draft.form = fromUse(draft.server!, draft.mode);
    draft.phase = 'saved';
    draft.error = undefined;
    draft.inputError = false;
    // The authoritative detail now contains all uploaded files. Remove queued
    // blobs/metadata so subsequent edits use authorized server thumbnails.
    draft.uploads = [];
    await save();
  } catch (error) {
    draft.error = error instanceof Error ? error.message : '전송하지 못했습니다.';
    if (error instanceof ApiError) {
      // A validation rejection proves this create did not commit. Only ambiguous
      // outcomes need the original POST retained while the user corrects inputs.
      if (!draft.serverId && error.code === 'VALIDATION_FAILED') draft.pendingCreate = undefined;
      if (error.code === 'SUBMIT_BLOCKED') {
        draft.phase = 'editing';
        draft.inputError = true;
        draft.intent = undefined;
        draft.request = undefined;
        draft.submitRequest = undefined;
        draft.savedRequest = false;
      } else if (error.code === 'STATEMENT_LOCKED') {
        if (draft.mode === 'driver' && /명세.*취소/.test(error.message))
          draft.error = '정산 확정된 운행입니다. 수정이 필요하면 담당자에게 문의하세요';
        draft.phase = 'blocked';
        if (draft.serverId) {
          try {
            draft.server = await io.get<UseDetail>(`/api/uses/${draft.serverId}`);
          } catch {
            /* Preserve local edits when the detail is unavailable. */
          }
        }
      } else if (stopStatuses.includes(error.status)) draft.phase = 'blocked';
      else if (error.code === 'VERSION_CONFLICT') {
        draft.phase = 'conflict';
        if (draft.serverId) {
          try {
            draft.conflict = await io.get<UseDetail>(`/api/uses/${draft.serverId}`);
          } catch {
            /* Keep the local edits if latest detail is unavailable. */
          }
        }
      } else if (permanentClientError(error)) draft.phase = 'blocked';
    }
    await save();
  }
  return draft;
}
const running = new Map<string, Promise<void>>();
// Serialize local cancellation/discard with the same lock used by transmission.
// Otherwise an in-flight upload could resurrect a draft after it was removed.
export async function withQueuePaused<T>(userId: string, action: () => Promise<T>): Promise<T> {
  await running.get(userId);
  return 'locks' in navigator ? navigator.locks.request(`vehicle-sync-${userId}`, action) : action();
}
export function syncQueue(userId: string, retryAfterCurrent = false): Promise<void> {
  const inFlight = running.get(userId);
  if (inFlight) return retryAfterCurrent ? inFlight.then(() => syncQueue(userId)) : inFlight;
  const work = async () => {
    if (!navigator.onLine || activeUser() !== userId) return;
    for (const draft of await listDrafts(userId)) {
      if (activeUser() !== userId || !navigator.onLine) break;
      if (draft.phase === 'queued') await sendDraft(draft, putDraft);
    }
  };
  const promise = (
    'locks' in navigator ? navigator.locks.request(`vehicle-sync-${userId}`, work) : work()
  ).finally(() => running.delete(userId));
  running.set(userId, promise);
  return promise;
}
