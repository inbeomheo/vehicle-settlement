'use client';
import { evidenceInstruction } from '@/components/use-form/evidence-policy';
/* Authorized originals and local blob previews must bypass Next image optimization. */
/* eslint-disable @next/next/no-img-element */
import { useContext, useEffect, useId, useState } from 'react';
import { errorMessage } from '@/client/error-message';
import { useActionLock } from '@/client/use-action-lock';
import { evidenceKinds, type UseDetail } from '@/client/types';
import type { PendingEvidence } from '@/client/offline/store';
import { button, control, Field, Section, FixContext } from '@/components/use-form/fields';
import { prepareImage } from './resize';
function FileGlyph() {
  return (
    <span className="flex aspect-square w-full items-center justify-center bg-slate-100 text-slate-400">
      <svg
        aria-hidden="true"
        width="32"
        height="32"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M14 3H6v18h12V7Z M14 3v4h4" />
      </svg>
    </span>
  );
}
function uploadTone(status: string) {
  return status === 'FAILED' || status === 'failed'
    ? 'bg-red-600 text-white'
    : status === 'UPLOADED' || status === 'uploaded'
      ? 'bg-emerald-600 text-white'
      : 'bg-slate-700 text-white';
}
function Preview({ file }: { file: PendingEvidence }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!file.blob?.type.startsWith('image/')) return;
    const value = URL.createObjectURL(file.blob);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [file.blob]);
  // Local previews are object URLs; stored files always use the authorized download route.
  return url ? (
    <img src={url} alt={file.original_name ?? '첨부 사진'} className="aspect-square w-full object-cover" />
  ) : (
    <FileGlyph />
  );
}
export function EvidenceEditor({
  pending,
  validationError,
  existing,
  policy,
  onChange,
  onDelete,
  onRetry,
  onRemovePending,
  locked,
  canRemovePending = !locked,
  canRetry = true,
  onProcessingChange,
}: {
  pending: PendingEvidence[];
  validationError?: string;
  existing: UseDetail['evidence'];
  policy?: string;
  onChange: (files: PendingEvidence[]) => void;
  onDelete: (id: string, reason: string) => Promise<void>;
  onRetry: () => void;
  onRemovePending?: (id: string) => void;
  canRemovePending?: boolean;
  canRetry?: boolean;
  locked: boolean;
  onProcessingChange: (value: boolean) => void;
}) {
  const [kind, setKind] = useState<PendingEvidence['kind']>('PHOTO');
  const [slip, setSlip] = useState('');
  const [reason, setReason] = useState('');
  const [replaceId, setReplaceId] = useState('');
  const [deleteId, setDeleteId] = useState('');
  const [error, setError] = useState('');
  const { busy: processing, start: startProcessing, finish: finishProcessing } = useActionLock();
  const feedbackId = useId();
  const hasFixes = useContext(FixContext).some((fix) => fix.target === 'evidence');
  const evidenceFeedback = {
    'aria-invalid': validationError || hasFixes ? true : undefined,
    'aria-describedby':
      [validationError ? `${feedbackId}-error` : '', hasFixes ? feedbackId : ''].filter(Boolean).join(' ') ||
      undefined,
  };
  const fileLabel = `${button} justify-center focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-blue-700`;
  const [progress, setProgress] = useState<Record<string, number>>({});
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ uploadId: string; value: number }>).detail;
      setProgress((p) => ({ ...p, [detail.uploadId]: detail.value }));
    };
    window.addEventListener('vehicle-upload-progress', listener);
    return () => window.removeEventListener('vehicle-upload-progress', listener);
  }, []);
  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    if (!startProcessing()) return;
    setError('');
    onProcessingChange(true);
    try {
      if (replaceId && (!reason.trim() || files.length !== 1))
        throw new Error('교체 사유와 새 파일 한 개를 지정하세요.');
      const added: PendingEvidence[] = [];
      for (const file of Array.from(files)) {
        const prepared = await prepareImage(file);
        added.push({
          client_upload_id: crypto.randomUUID(),
          kind,
          blob: prepared.blob,
          original_name: prepared.name,
          status: 'pending',
          progress: 0,
          ...(replaceId ? { replacesId: replaceId, reason } : {}),
        });
      }
      onChange([...pending, ...added]);
      setReplaceId('');
      setReason('');
    } catch (e) {
      setError(errorMessage(e, '사진을 준비하지 못했습니다.'));
    } finally {
      finishProcessing();
      onProcessingChange(false);
    }
  }
  const serverFiles = existing.filter(
    (f) => !pending.some((p) => p.serverId === f.id || p.replacesId === f.id),
  );
  return (
    <Section title="사진·증빙" target="evidence" feedbackId={feedbackId}>
      {validationError && (
        <p
          role="alert"
          id={`${feedbackId}-error`}
          className="mb-3 rounded-lg border-2 border-red-500 bg-red-50 p-3 font-semibold text-red-800"
        >
          {validationError}
        </p>
      )}
      <p className="mb-3 text-sm text-slate-600">
        {evidenceInstruction(policy) || '필요한 사진이나 서류를 첨부하세요.'}
      </p>
      <div
        className={`grid grid-cols-2 gap-2.5 sm:grid-cols-3 ${serverFiles.length + pending.length ? 'mb-4' : ''}`}
      >
        {serverFiles.map((f) => (
          <div key={f.id} className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="relative">
              {f.upload_status === 'UPLOADED' && !f.text_value ? (
                <a href={`/api/evidence/${f.id}/file`} target="_blank" rel="noreferrer" className="block">
                  {f.mime?.startsWith('image/') ? (
                    <img
                      src={`/api/evidence/${f.id}/file`}
                      alt={f.original_name ?? '증빙'}
                      className="aspect-square w-full object-cover"
                    />
                  ) : (
                    <span className="flex aspect-square w-full items-center justify-center bg-slate-100 font-semibold text-blue-700 underline">
                      증빙 열기
                    </span>
                  )}
                </a>
              ) : f.text_value ? (
                <span className="flex aspect-square w-full items-center justify-center bg-slate-50 p-2 text-center font-bold break-all">
                  {f.text_value}
                </span>
              ) : (
                <FileGlyph />
              )}
              <span
                className={`absolute top-1.5 left-1.5 rounded px-1.5 py-0.5 text-xs font-bold ${uploadTone(f.upload_status)}`}
              >
                {f.upload_status === 'UPLOADED'
                  ? '업로드 완료'
                  : f.upload_status === 'FAILED'
                    ? '사진 업로드 실패'
                    : '사진 업로드 대기'}
              </span>
            </div>
            <p className="truncate px-2 pt-1.5 text-sm font-semibold">
              {evidenceKinds[f.kind]} · {f.text_value ?? f.original_name}
            </p>
            <div className="flex gap-1 p-1.5">
              <button
                className={`${button} min-h-11 flex-1 px-2 text-sm`}
                type="button"
                disabled={locked}
                onClick={() => {
                  setReplaceId(f.id);
                  setDeleteId('');
                  setReason('');
                }}
              >
                교체
              </button>
              <button
                className={`${button} min-h-11 flex-1 px-2 text-sm text-red-700`}
                type="button"
                disabled={locked}
                onClick={() => {
                  setDeleteId(f.id);
                  setReplaceId('');
                  setReason('');
                }}
              >
                삭제
              </button>
            </div>
          </div>
        ))}
        {pending.map((file) => (
          <div
            key={file.client_upload_id}
            className={`min-w-0 overflow-hidden rounded-lg border bg-white ${file.status === 'failed' ? 'border-red-400' : 'border-slate-200'}`}
          >
            <div className="relative">
              {file.text_value ? (
                <span className="flex aspect-square w-full items-center justify-center bg-slate-50 p-2 text-center font-bold break-all">
                  {file.text_value}
                </span>
              ) : (
                <Preview file={file} />
              )}
            </div>
            <div className="min-w-0 p-2">
              <p className="truncate text-sm font-semibold">
                {evidenceKinds[file.kind]} · {file.text_value ?? file.original_name}
              </p>
              <p
                className={`mt-1 inline-block rounded px-1.5 py-0.5 text-xs font-bold ${uploadTone(file.status)}`}
              >
                {file.status === 'uploaded'
                  ? '업로드 완료'
                  : file.status === 'failed'
                    ? '사진 업로드 실패'
                    : file.status === 'uploading'
                      ? `사진 업로드 중 ${progress[file.client_upload_id] ?? file.progress}%`
                      : '사진 업로드 대기'}
              </p>
              {file.status === 'uploading' && (
                <progress
                  aria-label="사진 업로드 진행률"
                  max="100"
                  value={progress[file.client_upload_id] ?? file.progress}
                  className="w-full"
                />
              )}
              {file.error && (
                <p className="mt-1 text-sm text-red-700">
                  {errorMessage(file.error, '사진 전송에 실패했습니다. 다시 보내기를 눌러 주세요.')}
                </p>
              )}
              <div className="mt-1.5 grid gap-1">
                {file.status === 'failed' && canRetry && (
                  <button type="button" className={`${button} min-h-11 px-2 text-sm`} onClick={onRetry}>
                    사진 다시 보내기
                  </button>
                )}
                {file.status !== 'uploaded' && file.status !== 'uploading' && canRemovePending && (
                  <button
                    type="button"
                    className={`${button} min-h-11 px-2 text-sm`}
                    onClick={() =>
                      onRemovePending
                        ? onRemovePending(file.client_upload_id)
                        : onChange(pending.filter((p) => p.client_upload_id !== file.client_upload_id))
                    }
                  >
                    첨부 취소
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      {!locked && (
        <div className="grid gap-3">
          {(replaceId || deleteId) && (
            <Field label="교체·삭제 사유">
              <input
                className={control}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="기존 증빙을 바꾸거나 삭제할 때 입력"
              />
            </Field>
          )}
          {deleteId && (
            <div className="rounded-lg bg-orange-50 p-3">
              <p>삭제 사유를 입력한 뒤 확인하세요.</p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className={`${button} text-red-700`}
                  disabled={processing}
                  onClick={async () => {
                    if (!reason.trim()) {
                      setError('삭제 사유를 입력하세요.');
                      return;
                    }
                    if (!startProcessing()) return;
                    onProcessingChange(true);
                    try {
                      await onDelete(deleteId, reason);
                      setDeleteId('');
                      setReason('');
                      setError('');
                    } catch (e) {
                      setError(errorMessage(e, '삭제하지 못했습니다.'));
                    } finally {
                      finishProcessing();
                      onProcessingChange(false);
                    }
                  }}
                >
                  증빙 삭제 확인
                </button>
                <button
                  type="button"
                  className={button}
                  disabled={processing}
                  onClick={() => {
                    setDeleteId('');
                    setReason('');
                  }}
                >
                  삭제 취소
                </button>
              </div>
            </div>
          )}
          {replaceId && (
            <p className="rounded-lg bg-orange-50 p-3">
              교체할 새 증빙을 첨부하세요.{' '}
              <button
                type="button"
                className="min-h-11 px-3 underline"
                onClick={() => {
                  setReplaceId('');
                  setReason('');
                }}
              >
                교체 취소
              </button>
            </p>
          )}
          <label className="flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center hover:border-blue-700 hover:bg-blue-50 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue-700">
            <svg
              aria-hidden="true"
              width="44"
              height="44"
              viewBox="0 0 24 24"
              className="text-slate-700"
              fill="currentColor"
            >
              <path d="M9 3 7.2 5H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3Zm3 14a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Zm0-2.2a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6Z" />
            </svg>
            <span className="text-[17px] font-bold">사진 촬영·추가</span>
            <span className="text-sm text-slate-600">찍거나 앨범·파일에서 고르세요</span>
            <input
              {...evidenceFeedback}
              aria-label="사진·파일 선택"
              type="file"
              accept="image/*,application/pdf"
              multiple={!replaceId}
              className="sr-only text-base"
              disabled={processing}
              onChange={(e) => {
                void addFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className={fileLabel}>
              카메라로 바로 촬영
              <input
                {...evidenceFeedback}
                aria-label="카메라 촬영"
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only text-base"
                disabled={processing}
                onChange={(e) => {
                  void addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
            <label className="grid min-w-0">
              <span className="sr-only">증빙 종류</span>
              <select
                aria-label="증빙 종류"
                className={control}
                value={kind}
                onChange={(e) => setKind(e.target.value as PendingEvidence['kind'])}
              >
                {Object.entries(evidenceKinds)
                  .filter(([v]) => v !== 'SLIP_NO')
                  .map(([v, n]) => (
                    <option key={v} value={v}>
                      {n}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          {policy === 'PHOTO_OR_ALTERNATIVE' && (
            <>
              <Field label="전표번호 (대체증빙)">
                <input
                  {...evidenceFeedback}
                  className={control}
                  value={slip}
                  onChange={(e) => setSlip(e.target.value)}
                />
              </Field>
              <button
                type="button"
                className={button}
                onClick={() => {
                  if (!slip.trim() || (replaceId && !reason.trim())) {
                    setError('전표번호와 교체 시 사유를 입력하세요.');
                    return;
                  }
                  onChange([
                    ...pending,
                    {
                      client_upload_id: crypto.randomUUID(),
                      kind: 'SLIP_NO',
                      text_value: slip.trim(),
                      status: 'pending',
                      progress: 0,
                      ...(replaceId ? { replacesId: replaceId, reason } : {}),
                    },
                  ]);
                  setSlip('');
                  setReplaceId('');
                }}
              >
                전표번호 첨부
              </button>
            </>
          )}
        </div>
      )}
      {processing && (
        <p role="status" className="mt-3">
          사진을 준비하고 있습니다…
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-red-700">
          {error}
        </p>
      )}
    </Section>
  );
}
