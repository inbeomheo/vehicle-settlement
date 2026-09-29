export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  }).catch(() => {
    throw new Error('인터넷 연결을 확인해 주세요. 저장된 요청은 다시 보낼 수 있습니다.');
  });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      response.status,
      body?.error?.code ?? 'NETWORK_ERROR',
      body?.error?.message ?? '서버 응답을 확인하지 못했습니다.',
      body?.error?.details,
    );
  if (!body || !('data' in body))
    throw new ApiError(502, 'INVALID_RESPONSE', '서버 응답을 확인하지 못했습니다. 다시 시도해 주세요.');
  return body.data as T;
}
export function mutate<T>(path: string, body: unknown, key = crypto.randomUUID(), method = 'POST') {
  return api<T>(path, { method, headers: { 'Idempotency-Key': key }, body: JSON.stringify(body) });
}
export function upload(path: string, blob: Blob, progress: (value: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', path);
    xhr.setRequestHeader('Content-Type', blob.type);
    xhr.timeout = 60000;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) progress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = xhr.ontimeout = () =>
      reject(new Error('사진 전송에 실패했습니다. 다시 보내기를 눌러 주세요.'));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let error;
      try {
        error = JSON.parse(xhr.responseText).error;
      } catch {
        /* A gateway may return a non-JSON response. */
      }
      reject(
        new ApiError(
          xhr.status,
          error?.code ?? 'UPLOAD_FAILED',
          error?.message ?? '사진 업로드에 실패했습니다.',
        ),
      );
    };
    xhr.send(blob);
  });
}
