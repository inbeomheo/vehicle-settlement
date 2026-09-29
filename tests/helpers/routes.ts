import type { Database } from '../../src/server/db/client';
import { withDatabase } from '../../src/server/db/client';
import type { RouteHandler } from '../../src/server/http';
export function callRoute(
  db: Database,
  handler: RouteHandler,
  options: {
    method?: string;
    path?: string;
    token?: string;
    body?: unknown;
    rawBody?: Uint8Array;
    headers?: Record<string, string>;
    params?: Record<string, string>;
  } = {},
) {
  const headers = new Headers(options.headers);
  if (options.token) headers.set('cookie', `sid=${options.token}`);
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  const body = options.rawBody
    ? new Uint8Array(options.rawBody)
    : options.body === undefined
      ? undefined
      : JSON.stringify(options.body);
  const request = new Request(`http://localhost:3000${options.path ?? '/api/test'}`, {
    method: options.method ?? 'GET',
    headers,
    body,
  });
  return withDatabase(db, () => handler(request, { params: Promise.resolve(options.params ?? {}) }));
}
