'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { DriverProfile } from '@/server/services/driver-profiles';
import { DriverInformationFields, type DriverInformationValues } from './driver-information-fields';
import { button, primary } from './use-form/fields';
import { buttonClass, secondaryClass, mutate, useRemote, Notice } from './manager/common';
type Business = Pick<
  DriverProfile,
  'biz_no' | 'representative_name' | 'address' | 'business_type' | 'business_item'
> & { id: string; name: string; kind: string; created_at: string };
const businessNumber = (value: string | null) => (value ?? '').replace(/\D/g, '');

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
    representative_name: profile.representative_name ?? '',
    address: profile.address ?? '',
    business_type: profile.business_type ?? '',
    business_item: profile.business_item ?? '',
    plate_no: profile.plate_no ?? '',
    vehicle_type: profile.vehicle_type ?? '카고',
    tonnage: profile.tonnage ?? '',
  });
  const businesses = useRemote<Business[]>(manager ? '/api/admin/counterparties' : null);
  const currentBusiness = { ...profile, name: profile.business_name ?? '' };
  function matchingBusiness(number: string) {
    if (profile.affiliations.length && businessNumber(number) === businessNumber(profile.biz_no))
      return currentBusiness;
    return businessNumber(number) && manager
      ? businesses.data
          ?.toSorted((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
          .find(
            (party) =>
              ['DRIVER_BUSINESS', 'CARRIER'].includes(party.kind) &&
              businessNumber(party.biz_no) === businessNumber(number),
          )
      : undefined;
  }
  function withBusiness(
    value: DriverInformationValues,
    party: Pick<Business, 'name' | 'representative_name' | 'address' | 'business_type' | 'business_item'>,
  ) {
    return {
      ...value,
      business_name: party.name,
      representative_name: party.representative_name ?? '',
      address: party.address ?? '',
      business_type: party.business_type ?? '',
      business_item: party.business_item ?? '',
    };
  }
  const matchedBusiness = matchingBusiness(value.biz_no);
  const sameBusiness = businessNumber(value.biz_no) === businessNumber(profile.biz_no);
  const readOnlyBusiness = Boolean(matchedBusiness && (!sameBusiness || !profile.business_details_editable));
  const formValue = matchedBusiness && readOnlyBusiness ? withBusiness(value, matchedBusiness) : value;
  const businessReady = !manager || Boolean(businesses.data);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || !businessReady) return;
        setBusy(true);
        setError('');
        try {
          await mutate(manager ? `/api/drivers/${profile.id}` : '/api/driver-profile', 'PATCH', {
            ...formValue,
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
      <Notice error={businesses.error} onRetry={businesses.refresh} />
      <fieldset disabled={busy || !businessReady}>
        <DriverInformationFields
          value={formValue}
          onChange={(next) => {
            const match = matchingBusiness(next.biz_no);
            setValue(next.biz_no !== value.biz_no && match ? withBusiness(next, match) : next);
          }}
          manager={manager}
          businessDetailsReadOnly={readOnlyBusiness}
          businessNumberRequired={
            !(!profile.biz_no && sameBusiness && formValue.business_name === profile.business_name)
          }
        />
      </fieldset>
      {error && (
        <p role="alert" className="text-red-800">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button disabled={busy || !businessReady} className={manager ? buttonClass : primary}>
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
