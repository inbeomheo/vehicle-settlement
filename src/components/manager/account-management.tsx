'use client';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/ui/modal';
import { useBusy } from '@/components/ui/use-busy';
import { mutate, secondaryClass } from './common';

export function useDisabledAccounts() {
  const [showDisabled, setShowDisabled] = useState(false);
  useEffect(() => {
    const restore = () =>
      setShowDisabled(new URLSearchParams(window.location.search).get('show_disabled') === '1');
    restore();
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  function change(value: boolean) {
    const url = new URL(window.location.href);
    if (value) url.searchParams.set('show_disabled', '1');
    else url.searchParams.delete('show_disabled');
    window.history.pushState(null, '', url.pathname + url.search + url.hash);
    setShowDisabled(value);
  }
  return { showDisabled, change };
}
export function DisabledAccountsToggle({
  count,
  checked,
  onChange,
}: {
  count: number;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="mb-4 flex min-h-11 w-fit items-center gap-2 text-sm font-semibold">
      <input
        type="checkbox"
        className="h-5 w-5"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      꺼진 계정 {count}명 보기
    </label>
  );
}
export function AccountDeleteAction({
  user,
  onDeleted,
}: {
  user: { id: string; name: string; version: number; deletable: boolean; delete_reason: string | null };
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const { busy, begin, end } = useBusy();
  if (!user.deletable)
    return <p className="col-span-2 basis-full text-sm text-slate-600">{user.delete_reason}</p>;
  return (
    <>
      <button
        type="button"
        className={secondaryClass}
        onClick={() => {
          setError('');
          setOpen(true);
        }}
      >
        삭제
      </button>
      {open && (
        <ConfirmDialog
          title={`${user.name} 계정을 삭제할까요?`}
          confirmLabel="계정 삭제"
          busy={busy}
          error={error}
          onClose={() => setOpen(false)}
          onConfirm={async () => {
            if (!begin()) return;
            setError('');
            try {
              await mutate(`/api/admin/users/${user.id}`, 'DELETE', { version: user.version });
              setOpen(false);
              onDeleted();
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : '계정을 삭제하지 못했습니다.');
            } finally {
              end();
            }
          }}
        >
          <p>
            {user.name} 계정과 다른 곳에서 쓰지 않는 연결 기사·사업자·차량 정보를 삭제합니다. 삭제하면 되돌릴
            수 없어요.
          </p>
          <p>계정만 잠시 막으려면 ‘계정 끄기’를 사용하세요. 삭제할 때 기록이 있는지 다시 확인합니다.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
