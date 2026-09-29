export function streamingRequest(chunkSize: number, headers: Record<string, string> = {}) {
  let emitted = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (emitted === 8) return controller.close();
        emitted++;
        controller.enqueue(new Uint8Array(chunkSize).fill(32));
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const request = new Request('http://localhost:3000/api/test', {
    method: 'POST',
    body: stream,
    headers,
    duplex: 'half',
  } as RequestInit);
  return { request, state: () => ({ emitted, cancelled }) };
}
