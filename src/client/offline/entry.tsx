import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { FormWorkspace } from '@/components/use-form/use-form';
import { DriverDashboard } from '@/client/driver-dashboard';
import { activeUser, cachedValue, markLoggedOut, type Bootstrap } from './store';
import { syncQueue } from './engine';
function OfflineApp() {
  const [boot, setBoot] = useState<Bootstrap>();
  const [error, setError] = useState('');
  useEffect(() => {
    const userId = activeUser();
    if (!userId) {
      setError('로그인한 계정이 없습니다. 인터넷 연결 후 로그인해 주세요.');
      return;
    }
    void cachedValue<Bootstrap>(userId, 'bootstrap').then((data) => {
      if (data) setBoot(data);
      else setError('처음 사용할 때는 인터넷 연결이 필요합니다.');
    });
    const sync = () => {
      void syncQueue(userId);
    };
    const switched = () => {
      if (activeUser() !== userId) {
        setBoot(undefined);
        setError('계정이 변경되었습니다. 연결 후 다시 로그인해 주세요.');
      }
    };
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('storage', switched);
    const timer = window.setInterval(sync, 30000);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('storage', switched);
      clearInterval(timer);
    };
  }, []);
  if (error)
    return (
      <main className="p-6">
        <p role="alert">{error}</p>
        <a className="mt-4 inline-block underline" href="/login">
          로그인
        </a>
      </main>
    );
  if (!boot) return <p className="p-6">이 휴대폰의 초안을 복구하고 있습니다…</p>;
  const mode = boot.user.role === 'DRIVER' ? 'driver' : 'manager';
  const path = location.pathname;
  const id = path.match(/^\/(?:d|m)\/uses\/([^/]+)/)?.[1];
  return (
    <>
      <header className="flex items-center justify-between gap-3 border-b bg-white p-4">
        <a className="font-bold" href={mode === 'driver' ? '/d' : '/m/uses/new'}>
          차량 사용·정산
        </a>
        <button
          onClick={() => {
            markLoggedOut();
            setBoot(undefined);
            setError('로그아웃되어 기기 데이터가 격리되었습니다. 온라인에서 다시 로그인해 주세요.');
          }}
          className="min-h-11 rounded-xl border px-3"
        >
          로그아웃
        </button>
      </header>
      <div className="bg-amber-50 px-4 py-2 text-sm text-amber-900">
        기기 저장 화면 · 연결 후 서버 권한과 최신 내용을 확인합니다.
      </div>
      <main className="px-4 pt-6 pb-28">
        {path === '/d' ? <DriverDashboard /> : <FormWorkspace boot={boot} mode={mode} useId={id} />}
      </main>
      {mode === 'driver' && (
        <nav
          aria-label="주 메뉴"
          className="fixed inset-x-0 bottom-0 grid grid-cols-3 border-t bg-white p-2 text-center font-semibold"
        >
          <a className="py-3" href="/d">
            내 운행
          </a>
          <a className="py-3" href="/d/new">
            운행 등록
          </a>
          <a className="py-3" href="/d/settlements">
            내 정산
          </a>
        </nav>
      )}
    </>
  );
}
createRoot(document.getElementById('offline-root')!).render(<OfflineApp />);
