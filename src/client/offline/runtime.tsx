'use client';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import type { Lookups, Mode, UseList, User } from '../types';
import {
  activateUser,
  flushDrafts,
  activeUser,
  cacheValue,
  cachedValue,
  isolateUser,
  type Bootstrap,
  LOGGED_OUT,
} from './store';
import { syncQueue } from './engine';
export function useBootstrap(mode: Mode) {
  const [data, setData] = useState<Bootstrap>();
  const [error, setError] = useState('');
  const [authRequired, setAuthRequired] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    async function start() {
      setError('');
      setAuthRequired(false);
      const previous = activeUser();
      if (localStorage.getItem(LOGGED_OUT)) {
        if (navigator.onLine) await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
        if (alive) {
          setError('로그아웃 상태입니다. 다시 로그인해 주세요.');
          setAuthRequired(true);
        }
        return;
      }
      try {
        const user = await api<User>('/api/me');
        if (!alive || localStorage.getItem(LOGGED_OUT)) return;
        if (activeUser() !== previous && activeUser() !== user.id) return;
        if ((user.role === 'DRIVER') !== (mode === 'driver'))
          throw new ApiError(403, 'FORBIDDEN', '이 계정에서 사용할 수 없는 화면입니다.');
        activateUser(user.id);
        const [lookups, recent] = await Promise.all([
          api<Lookups>('/api/lookups'),
          api<UseList>('/api/uses?pageSize=100&sort=use_date'),
        ]);
        if (!alive || activeUser() !== user.id || localStorage.getItem(LOGGED_OUT)) return;
        const boot = { user, lookups, recent, cachedAt: Date.now() };
        await cacheValue(user.id, 'bootstrap', boot);
        if (alive) setData(boot);
      } catch (e) {
        if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
          isolateUser();
          if (alive) {
            setError(e.message);
            setAuthRequired(e.status === 401);
          }
          return;
        }
        const cached = previous ? await cachedValue<Bootstrap>(previous, 'bootstrap') : undefined;
        if (
          cached &&
          activeUser() === previous &&
          (cached.user.role === 'DRIVER') === (mode === 'driver') &&
          !(e instanceof ApiError)
        ) {
          if (alive) setData(cached);
        } else if (alive) setError('잠시 후 다시 시도해 주세요.');
      }
    }
    void start();
    return () => {
      alive = false;
    };
  }, [mode, attempt]);
  useEffect(() => {
    if (!data) return;
    const identityChange = () => {
      if (activeUser() !== data.user.id) {
        setData(undefined);
        setError('계정이 변경되었습니다. 다시 로그인해 주세요.');
        setAuthRequired(true);
      }
    };
    window.addEventListener('storage', identityChange);
    window.addEventListener('vehicle-offline-change', identityChange);
    const retry = () => {
      void syncQueue(data.user.id);
    };
    retry();
    window.addEventListener('online', retry);
    const visible = () => {
      if (document.visibilityState === 'visible') retry();
    };
    document.addEventListener('visibilitychange', visible);
    const interval = window.setInterval(retry, 30000);
    return () => {
      window.removeEventListener('storage', identityChange);
      window.removeEventListener('vehicle-offline-change', identityChange);
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', visible);
      clearInterval(interval);
    };
  }, [data]);
  return { data, error, authRequired, retry: () => setAttempt((value) => value + 1) };
}
export function PwaRegistration() {
  const [waiting, setWaiting] = useState<ServiceWorker>();
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const reloading = useRef(false);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let alive = true;
    let registration: ServiceWorkerRegistration | undefined;
    let installing: ServiceWorker | null = null;
    let controlled = Boolean(navigator.serviceWorker.controller);
    const inspect = () => {
      if (alive && registration?.waiting && navigator.serviceWorker.controller)
        setWaiting(registration.waiting);
    };
    const found = () => {
      installing?.removeEventListener('statechange', inspect);
      installing = registration?.installing ?? null;
      installing?.addEventListener('statechange', inspect);
      inspect();
    };
    const reload = async () => {
      // Initial installation claims clients too; it must not reload the first visit.
      if (!controlled) {
        controlled = true;
        return;
      }
      if (reloading.current) return;
      reloading.current = true;
      setChanged(true);
      setBusy(true);
      try {
        await flushDrafts('update');
        window.location.reload();
      } catch (cause) {
        reloading.current = false;
        setBusy(false);
        setError(cause instanceof Error ? cause.message : '초안을 저장하지 못했습니다. 다시 시도해 주세요.');
      }
    };
    const check = () => {
      if (navigator.onLine && document.visibilityState === 'visible')
        void registration?.update().catch(() => {});
    };
    navigator.serviceWorker.addEventListener('controllerchange', reload);
    void navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((value) => {
        if (!alive) return;
        registration = value;
        registration.addEventListener('updatefound', found);
        found();
        check();
      })
      .catch(() => {});
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      alive = false;
      navigator.serviceWorker.removeEventListener('controllerchange', reload);
      registration?.removeEventListener('updatefound', found);
      installing?.removeEventListener('statechange', inspect);
      window.removeEventListener('online', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  async function update() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await flushDrafts('update');
      if (changed) window.location.reload();
      else waiting?.postMessage({ type: 'SKIP_WAITING' });
    } catch (cause) {
      setBusy(false);
      setError(cause instanceof Error ? cause.message : '초안을 저장하지 못했습니다. 다시 시도해 주세요.');
    }
  }
  if (!waiting && !changed) return null;
  return (
    <aside
      className="sticky top-0 z-50 space-y-2 border-b border-amber-200 bg-amber-50 p-3 text-amber-950"
      aria-label="앱 업데이트"
    >
      <p className="font-semibold">새 버전이 있어요</p>
      <button
        type="button"
        className="min-h-11 rounded-lg bg-ink px-4 py-2 font-semibold text-white disabled:opacity-50"
        disabled={busy}
        onClick={() => void update()}
      >
        {busy ? '새 버전 적용 중…' : '초안 저장 후 새로고침'}
      </button>
      {error && <p role="alert">{error}</p>}
    </aside>
  );
}
