// Leave room for request/response overhead below the serverless 4.5MB limit.
export const EVIDENCE_MAX_BYTES = 4 * 1024 * 1024;
export const PDF_TOO_LARGE = '4MB 이하 PDF만 올릴 수 있어요';
export const IMAGE_TOO_LARGE = '사진 용량이 큽니다. 4MB 이하 사진을 선택해 주세요.';

// Multipart metadata fits in this reserve; the entire import request stays below 4MiB.
export const IMPORT_REQUEST_MAX_BYTES = 4 * 1024 * 1024;
export const IMPORT_MULTIPART_RESERVE_BYTES = 64 * 1024;
export const IMPORT_MAX_BYTES = IMPORT_REQUEST_MAX_BYTES - IMPORT_MULTIPART_RESERVE_BYTES;
export const IMPORT_MAX_MB = Number((IMPORT_MAX_BYTES / 1024 / 1024).toFixed(2));
export const importFileSizeMessage = (limit = IMPORT_MAX_BYTES) =>
  `파일은 ${Number((limit / 1024 / 1024).toFixed(2))}MB 이하로 나눠서 올려 주세요.`;
