import { AppError } from './errors';

// Bound bytes before decoding or parsing; Content-Length is only an early hint.
export async function readBoundedBody(
  request: Request,
  limit: number,
  message = '요청 크기가 너무 큽니다.',
): Promise<Buffer> {
  const reader = request.body?.getReader();
  const reject = () => new AppError('PAYLOAD_TOO_LARGE', message);
  if (!reader) {
    if (Number(request.headers.get('content-length')) > limit) throw reject();
    return Buffer.alloc(0);
  }
  let complete = false;
  try {
    if (Number(request.headers.get('content-length')) > limit) throw reject();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        complete = true;
        return Buffer.concat(chunks, size);
      }
      size += value.byteLength;
      if (size > limit) throw reject();
      chunks.push(value);
    }
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
