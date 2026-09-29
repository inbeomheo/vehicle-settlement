'use client';
import { evidenceInstruction } from '@/components/use-form/evidence-policy';
/* Authorized originals and local blob previews must bypass Next image optimization. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from 'react';
import { evidenceKinds, type UseDetail } from '@/client/types';
import type { PendingEvidence } from '@/client/offline/store';
import { button, control, Field, Section } from '@/components/use-form/fields';
import { prepareImage } from './resize';
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
    <img src={url} alt={file.original_name ?? '첨부 사진'} className="h-24 w-24 rounded-xl object-cover" />
  ) : null;
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
  const [processing, setProcessing] = useState(false);
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
    setError('');
    setProcessing(true);
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
      setError(e instanceof Error ? e.message : '사진을 준비하지 못했습니다.');
    } finally {
      setProcessing(false);
      onProcessingChange(false);
    }
  }
  const serverFiles = existing.filter(
    (f) => !pending.some((p) => p.serverId === f.id || p.replacesId === f.id),
  );
  return (
    <Section title="증빙" target="evidence">
      {validationError && (
        <p
          role="alert"
          className="mb-4 rounded-xl border-2 border-red-500 bg-red-50 p-4 font-semibold text-red-800"
        >
          {validationError}
        </p>
      )}
      <p className="mb-4 text-sm text-slate-600">
        {evidenceInstruction(policy) || '필요한 사진이나 서류를 첨부하세요.'}
      </p>
      <div className="grid gap-3">
        {serverFiles.map((f) => (
          <div key={f.id} className="rounded-xl border border-slate-200 p-3">
            <p className="font-bold">
              {evidenceKinds[f.kind]} · {f.text_value ?? f.original_name}
            </p>
            {f.upload_status === 'UPLOADED' && !f.text_value && (
              <a
                href={`/api/evidence/${f.id}/file`}
                target="_blank"
                rel="noreferrer"
                className="my-2 inline-block text-blue-700 underline"
              >
                {f.mime?.startsWith('image/') ? (
                  <img
                    src={`/api/evidence/${f.id}/file`}
                    alt={f.original_name ?? '증빙'}
                    className="h-24 w-24 rounded-xl object-cover"
                  />
                ) : (
                  '증빙 열기'
                )}
              </a>
            )}
            <p className="text-sm">
              {f.upload_status === 'UPLOADED'
                ? '업로드 완료'
                : f.upload_status === 'FAILED'
                  ? '사진 업로드 실패'
                  : '사진 업로드 대기'}
            </p>
            <div className="mt-2 flex gap-2">
              <button
                className={button}
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
                className={`${button} text-red-700`}
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
            className="flex flex-wrap gap-3 rounded-xl border border-slate-200 p-3"
          >
            <Preview file={file} />
            <div className="min-w-0 flex-1">
              <p className="break-all font-semibold">
                {evidenceKinds[file.kind]} · {file.text_value ?? file.original_name}
              </p>
              <p className={`mt-2 text-sm ${file.status === 'failed' ? 'text-red-700' : 'text-slate-600'}`}>
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
              {file.error && <p className="mt-1 text-sm text-red-700">{file.error}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                {file.status === 'failed' && canRetry && (
                  <button type="button" className={button} onClick={onRetry}>
                    사진 다시 보내기
                  </button>
                )}
                {file.status !== 'uploaded' && file.status !== 'uploading' && canRemovePending && (
                  <button
                    type="button"
                    className={button}
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
        <div className="mt-5 grid gap-4">
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
            <div className="rounded-xl bg-amber-50 p-3">
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
                    setProcessing(true);
                    onProcessingChange(true);
                    try {
                      await onDelete(deleteId, reason);
                      setDeleteId('');
                      setReason('');
                      setError('');
                    } catch (e) {
                      setError(e instanceof Error ? e.message : '삭제하지 못했습니다.');
                    } finally {
                      setProcessing(false);
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
            <p className="rounded-xl bg-amber-50 p-3">
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
          <Field label="증빙 종류">
            <select
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
          </Field>
          <label className={`${button} justify-start`}>
            카메라 촬영
            <input
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
          <label className={`${button} justify-start`}>
            사진·파일 선택
            <input
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
          {policy === 'PHOTO_OR_ALTERNATIVE' && (
            <>
              <Field label="전표번호 (대체증빙)">
                <input className={control} value={slip} onChange={(e) => setSlip(e.target.value)} />
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
          <p className="text-xs text-slate-500">사진은 긴 변 2,000px, JPEG 품질 80%로 변환됩니다.</p>
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
