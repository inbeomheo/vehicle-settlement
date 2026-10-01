'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { DriverProfile } from '@/server/services/driver-profiles';
import { Empty, Notice, useRemote } from './manager/common';
import { DriverProfileEditor } from './driver-profile-editor';
import { button } from './use-form/fields';
export function MyDriverProfile() {
  const profile = useRemote<DriverProfile>('/api/driver-profile');
  const [success, setSuccess] = useState('');
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">내 정보</h1>
        <Link href="/d" className={button}>
          홈으로
        </Link>
      </div>
      <Notice error={profile.error} success={success} onRetry={profile.refresh} />
      {profile.loading ? (
        <Empty loading />
      ) : (
        profile.data && (
          <DriverProfileEditor
            key={profile.data.version}
            profile={profile.data}
            onSaved={() => {
              setSuccess('내 정보를 저장했습니다.');
              profile.refresh();
            }}
          />
        )
      )}
    </div>
  );
}
