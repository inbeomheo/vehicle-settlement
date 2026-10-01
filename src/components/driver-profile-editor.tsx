'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { DriverProfile } from '@/server/services/driver-profiles';
import { DriverInformationFields, type DriverInformationValues } from './driver-information-fields';
import { button, primary } from './use-form/fields';
import { buttonClass, secondaryClass, mutate } from './manager/common';
export function DriverProfileEditor({
  profile,
  manager = false,
  onSaved,
  onClose,
}: {
  profile: DriverProfile;
  manager?: boolean;
  onSaved: () => void;
  onClose?: () => void;
}) {
  const [value, setValue] = useState<DriverInformationValues>({
    name: profile.name,
    phone: profile.phone ?? '',
    business_name: profile.business_name ?? '',
    biz_no: profile.biz_no ?? '',
    plate_no: profile.plate_no ?? '',
    vehicle_type: profile.vehicle_type ?? '카고',
    tonnage: profile.tonnage ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError('');
        try {
          await mutate(manager ? `/api/drivers/${profile.id}` : '/api/driver-profile', 'PATCH', {
            ...value,
            version: profile.version,
          });
          onSaved();
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : '저장하지 못했습니다.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-sm text-slate-600">
        변경 사항은 오늘부터 적용됩니다. 과거 운행에 저장된 정보는 유지됩니다.
      </p>
      <DriverInformationFields value={value} onChange={setValue} manager={manager} />
      {error && (
        <p role="alert" className="text-red-800">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button disabled={busy} className={manager ? buttonClass : primary}>
          {busy ? '저장 중…' : '정보 저장'}
        </button>
        {onClose && (
          <button
            type="button"
            disabled={busy}
            className={manager ? secondaryClass : button}
            onClick={onClose}
          >
            닫기
          </button>
        )}
        {!manager && (
          <Link href="/d/account" className={button}>
            비밀번호 변경
          </Link>
        )}
      </div>
    </form>
  );
}
