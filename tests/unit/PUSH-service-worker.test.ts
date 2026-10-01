import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

function worker() {
  type Event = {
    data?: { json: () => unknown };
    notification?: { close: () => void; data: { url: string } };
    waitUntil: (promise: Promise<unknown>) => void;
  };
  const listeners = new Map<string, (event: Event) => void>();
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const openWindow = vi.fn().mockResolvedValue(undefined);
  const matchAll = vi.fn().mockResolvedValue([]);
  runInNewContext(readFileSync('public/sw.js', 'utf8'), {
    URL,
    importScripts: vi.fn(),
    self: {
      VEHICLE_SHELL_VERSION: 'test',
      location: { origin: 'https://vehicle.example' },
      addEventListener: (type: string, callback: (event: Event) => void) => listeners.set(type, callback),
      registration: { showNotification },
      clients: { openWindow, matchAll },
    },
  });
  async function dispatch(type: string, event: Omit<Event, 'waitUntil'>) {
    const promises: Promise<unknown>[] = [];
    listeners.get(type)!({ ...event, waitUntil: (promise) => promises.push(promise) });
    await Promise.all(promises);
  }
  return { listeners, showNotification, openWindow, matchAll, dispatch };
}
it('기존 오프라인 이벤트 유지, push는 화면 알림과 안전한 상세 URL을 저장한다', async () => {
  const w = worker();
  for (const event of ['install', 'activate', 'fetch', 'push', 'notificationclick'])
    expect(w.listeners.has(event)).toBe(true);
  const url = '/m/uses/11111111-1111-4111-8111-111111111111';
  await w.dispatch('push', {
    data: { json: () => ({ title: '운행 확인 요청', body: '기사 · 현장 · 300,000원', url, tag: 'use-1' }) },
  });
  expect(w.showNotification).toHaveBeenCalledWith(
    '운행 확인 요청',
    expect.objectContaining({ body: '기사 · 현장 · 300,000원', data: { url }, tag: 'use-1' }),
  );
  await w.dispatch('push', {
    data: {
      json: () => {
        throw new Error('bad json');
      },
    },
  });
  expect(w.showNotification).toHaveBeenLastCalledWith(
    '차량 사용·정산 알림',
    expect.objectContaining({ data: { url: '/' } }),
  );
});
it('클릭은 정확히 같은 상세 창만 재사용하며 다른 폼은 보존, 외부 URL은 열지 않는다', async () => {
  const w = worker();
  const close = vi.fn();
  const path = '/d/uses/11111111-1111-4111-8111-111111111111';
  const focus = vi.fn();
  w.matchAll.mockResolvedValue([{ url: `https://vehicle.example${path}`, focus }]);
  await w.dispatch('notificationclick', { notification: { close, data: { url: path } } });
  expect(close).toHaveBeenCalledOnce();
  expect(focus).toHaveBeenCalledOnce();
  expect(w.openWindow).not.toHaveBeenCalled();
  w.matchAll.mockResolvedValue([{ url: 'https://vehicle.example/d/new', focus }]);
  await w.dispatch('notificationclick', { notification: { close, data: { url: path } } });
  expect(w.openWindow).toHaveBeenLastCalledWith(`https://vehicle.example${path}`);
  await w.dispatch('notificationclick', { notification: { close, data: { url: 'https://evil.example' } } });
  expect(w.openWindow).toHaveBeenLastCalledWith('https://vehicle.example/');
});
