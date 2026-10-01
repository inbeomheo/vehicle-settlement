'use client';
import { useCallback, useEffect, useState } from 'react';
import { requestJson } from '@/components/ui/request';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const { response, body } = await requestJson(url, {
    cache: 'no-store',
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const details = Array.isArray(body.error?.details)
      ? body.error.details
          .map((item: { message?: string }) => item.message)
          .filter(Boolean)
          .join(' ')
      : '';
    throw new ApiError(
      `${body.error?.message ?? '요청에 실패했습니다.'}${details ? ' ' + details : ''}`,
      response.status,
    );
  }
  return body.data;
}
export function mutate<T>(url: string, method: string, data: unknown = {}) {
  return api<T>(url, {
    method,
    body: JSON.stringify(data),
    headers: { 'idempotency-key': crypto.randomUUID() },
  });
}
export function useRemote<T>(url: string | null) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!url) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setData(undefined);
    setError('');
    api<T>(url, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((reason: Error) => {
        if (!controller.signal.aborted) {
          setError(reason.message);
          setData(undefined);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [url, revision]);
  return { data, error, loading, refresh };
}
