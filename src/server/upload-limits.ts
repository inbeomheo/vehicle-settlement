import {
  IMPORT_MAX_BYTES,
  IMPORT_REQUEST_MAX_BYTES,
  IMPORT_MULTIPART_RESERVE_BYTES,
  importFileSizeMessage,
  EVIDENCE_MAX_BYTES,
} from '../shared/upload-limits';
export function uploadLimit(localDefault = EVIDENCE_MAX_BYTES) {
  const configured = process.env.MAX_UPLOAD_BYTES ?? (process.env.VERCEL ? '4194304' : undefined);
  if (configured === undefined) return localDefault;
  const limit = Number(configured);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('MAX_UPLOAD_BYTES는 양의 정수여야 합니다.');
  return Math.min(localDefault, limit);
}
export const uploadLimitMessage = (limit = uploadLimit()) =>
  `파일은 ${Number((limit / 1024 / 1024).toFixed(2))}MB 이하로 업로드하세요.`;

export const importRequestLimit = () => uploadLimit(IMPORT_REQUEST_MAX_BYTES);
export const importFileLimit = () =>
  Math.max(0, Math.min(IMPORT_MAX_BYTES, importRequestLimit() - IMPORT_MULTIPART_RESERVE_BYTES));
export const importUploadLimitMessage = () => importFileSizeMessage(importFileLimit());
