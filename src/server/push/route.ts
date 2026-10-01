import { after } from 'next/server';
import { getDb } from '../db/client';
import type { RouteHandler } from '../http';
import { pushConfig } from './config';
import { sendUsePush, type PushEvent } from './send';

export function withUsePush(handler: RouteHandler, event: PushEvent): RouteHandler {
  return async (request, route) => {
    const response = await handler(request, route);
    if (!response.ok || response.headers.get('idempotency-replayed') === 'true' || !pushConfig())
      return response;
    try {
      const { data } = await response.clone().json();
      const db = getDb();
      if (typeof data?.id === 'string' && typeof data.version === 'number') {
        after(() => sendUsePush(db, data.id, event, data.version));
      }
    } catch {
      console.warn('푸시 알림 예약 실패');
    }
    return response;
  };
}
