'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/client/api';
import { secondaryClass } from '@/components/manager/common';
import { button } from '@/components/use-form/fields';

type Config = { enabled: boolean; publicKey: string | null };
export function PushSettings({ manager = false }: { manager?: boolean }) {
  const [config, setConfig] = useState<Config>();
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('알림 설정 확인 중…');
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    let alive = true;
    async function load() {
      const ios =
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const standalone =
        matchMedia('(display-mode: standalone)').matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone;
      if (ios && !standalone) {
        setHint('iPhone·iPad는 공유 → 홈 화면에 추가한 앱에서 알림을 켤 수 있습니다.');
        setBusy(false);
        return;
      }
      if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        setHint('이 브라우저는 알림을 지원하지 않습니다. 최신 브라우저에서 열어 주세요.');
        setBusy(false);
        return;
      }
      setSupported(true);
      try {
        const next = await api<Config>('/api/push');
        if (!alive) return;
        setConfig(next);
        const registration = await navigator.serviceWorker.getRegistration('/');
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription && next.enabled) {
          const status = await api<{ subscribed: boolean }>('/api/push/subscriptions', {
            method: 'POST',
            body: JSON.stringify(subscription.toJSON()),
          });
          if (alive) setSubscribed(status.subscribed);
        }
        if (alive)
          setHint(
            !next.enabled
              ? '알림 서비스 준비 중입니다.'
              : Notification.permission === 'denied'
                ? '알림이 차단되어 있습니다. 브라우저 설정에서 알림을 허용해 주세요.'
                : '이 기기에서 운행 확인·보완 요청 알림을 받습니다.',
          );
      } catch {
        if (alive) {
          setHint('알림 상태를 확인해 주세요.');
          setError('알림 설정을 확인하지 못했습니다. 새로고침해 주세요.');
        }
      } finally {
        if (alive) setBusy(false);
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, []);
  async function toggle() {
    setBusy(true);
    setError('');
    try {
      // Permission must be requested directly from the user gesture (especially iOS).
      if (!subscribed && (await Notification.requestPermission()) !== 'granted') {
        setHint('알림이 허용되지 않았습니다. 브라우저 설정에서 알림을 허용해 주세요.');
        return;
      }
      await navigator.serviceWorker.register('/sw.js');
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('알림 준비가 지연되고 있습니다. 다시 시도해 주세요.')), 10000),
        ),
      ]);
      let subscription = await registration.pushManager.getSubscription();
      if (subscribed) {
        if (subscription) {
          await api('/api/push/subscriptions', {
            method: 'DELETE',
            body: JSON.stringify({ endpoint: subscription.endpoint }),
          });
          await subscription.unsubscribe();
        }
        setSubscribed(false);
        setHint('이 기기에서 알림을 껐습니다. 다시 켤 수 있습니다.');
      } else {
        if (!config?.publicKey) return;
        // A subscription left behind by another account or VAPID key must not be claimed.
        if (subscription) await subscription.unsubscribe();
        const bytes = Uint8Array.from(atob(config.publicKey.replace(/-/g, '+').replace(/_/g, '/')), (char) =>
          char.charCodeAt(0),
        );
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: bytes,
        });
        try {
          const saved = await api<{ subscribed: boolean }>('/api/push/subscriptions', {
            method: 'POST',
            body: JSON.stringify(subscription.toJSON()),
          });
          if (!saved.subscribed) throw new Error('알림 서비스 준비 중입니다.');
          setSubscribed(true);
          setHint('이 기기에서 운행 확인·보완 요청 알림을 받습니다.');
        } catch (error) {
          await subscription.unsubscribe();
          throw error;
        }
      }
    } catch (error) {
      setError(
        error instanceof ApiError ? error.message : '알림 설정을 바꾸지 못했습니다. 다시 시도해 주세요.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      aria-label="알림 설정"
      className={`min-w-0 rounded-lg p-3 ${manager ? 'my-3 border border-white/20 text-white' : 'mt-4 border border-slate-200 bg-white text-ink'}`}
    >
      <p className="font-semibold">알림 받기 · {subscribed ? '켜짐' : '꺼짐'}</p>
      <p aria-live="polite" className="mt-1 text-sm break-words">
        {hint}
      </p>
      {supported && (config?.enabled || subscribed) && (
        <button
          type="button"
          disabled={busy}
          onClick={toggle}
          className={`${manager ? secondaryClass : button} mt-3 w-full`}
        >
          {busy ? '설정 중…' : subscribed ? '알림 끄기' : '알림 받기'}
        </button>
      )}
      {error && (
        <p role="alert" className={`mt-2 text-sm ${manager ? 'text-red-200' : 'text-red-700'}`}>
          {error}
        </p>
      )}
    </section>
  );
}
