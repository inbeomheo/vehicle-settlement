'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { Lookups, Mode, UseList, User } from '../types';
import {
  activateUser,
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
  useEffect(() => {
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
  return null;
}
