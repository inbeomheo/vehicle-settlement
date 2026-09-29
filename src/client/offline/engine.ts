import { ApiError, api, mutate, upload } from '../api';
import type { UseDetail, User } from '../types';
import { activeUser, listDrafts, putDraft, type Draft } from './store';

export type Transport = {
  get: typeof api;
  mutate: typeof mutate;
  upload: typeof upload;
  isActive: (id: string) => boolean;
};
const transport: Transport = { get: api, mutate, upload, isActive: (id) => activeUser() === id };
const stopStatuses = [401, 403, 404];
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
    if (!draft.savedRequest && draft.request) {
      assertOwner();
      const result = await io.mutate<UseDetail>(
        draft.serverId ? `/api/uses/${draft.serverId}` : '/api/uses',
        draft.request.payload,
        draft.request.key,
        draft.serverId ? 'PATCH' : 'POST',
      );
      draft.serverId = result.id;
      draft.server = result;
      draft.version = result.version;
      draft.savedRequest = true;
      await save();
    }
    if (!draft.serverId) throw new Error('전송할 사용 건이 없습니다. 입력 내용을 확인하세요.');
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
        if (error instanceof ApiError && stopStatuses.includes(error.status)) throw error;
      }
    }
    assertOwner();
    draft.server = await io.get<UseDetail>(`/api/uses/${draft.serverId}`);
    draft.version = draft.server.version;
    if (draft.uploads.some((f) => f.status !== 'uploaded')) {
      draft.error = '사용 건은 서버에 저장되었습니다. 사진 업로드 실패: 사진만 다시 보냅니다.';
      await save();
      return draft;
    }
    if (draft.intent === 'submit' && !['SUBMITTED', 'APPROVED'].includes(draft.server.review_status)) {
      if (!draft.submitRequest) {
        draft.submitRequest = { key: crypto.randomUUID(), version: draft.version };
        await save();
      }
      assertOwner();
      draft.server = await io.mutate<UseDetail>(
        `/api/uses/${draft.serverId}/submit`,
        { version: draft.submitRequest.version },
        draft.submitRequest.key,
      );
      draft.version = draft.server.version;
    }
    draft.phase = 'saved';
    draft.error = undefined;
    // The authoritative detail now contains all uploaded files. Remove queued
    // blobs/metadata so subsequent edits use authorized server thumbnails.
    draft.uploads = [];
    await save();
  } catch (error) {
    draft.error = error instanceof Error ? error.message : '전송하지 못했습니다.';
    if (error instanceof ApiError) {
      if (stopStatuses.includes(error.status)) draft.phase = 'blocked';
      else if (error.code === 'VERSION_CONFLICT') {
        draft.phase = 'conflict';
        if (draft.serverId) {
          try {
            draft.conflict = await io.get<UseDetail>(`/api/uses/${draft.serverId}`);
          } catch {
            /* Keep the local edits if latest detail is unavailable. */
          }
        }
      } else if (error.status >= 400 && error.status < 500) draft.phase = 'blocked';
    }
    await save();
  }
  return draft;
}
const running = new Map<string, Promise<void>>();
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
