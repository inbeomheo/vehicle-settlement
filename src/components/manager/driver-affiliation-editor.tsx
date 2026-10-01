'use client';
import { useState, type FormEvent } from 'react';
import type { DriverProfile } from '@/server/services/driver-profiles';
import { Field, Notice, inputClass, mutate, buttonClass, secondaryClass } from './common';

export function DriverAffiliationEditor({
  profile,
  onSaved,
  onClose,
}: {
  profile: DriverProfile;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [affiliationId, setAffiliationId] = useState(profile.affiliations[0]?.id ?? '');
  const affiliation = profile.affiliations.find((row) => row.id === affiliationId);
  const [start, setStart] = useState(affiliation?.valid_from ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await mutate(`/api/drivers/${profile.id}`, 'PATCH', {
        version: profile.version,
        affiliation_id: affiliationId,
        valid_from: start,
      });
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '소속 시작일을 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="space-y-4">
      <p>
        가입 전 운행을 입력하려면 해당 지급처의 소속 시작일을 운행일 이전으로 정하세요. 다른 소속 기간과 겹칠
        수 없습니다.
      </p>
      <Field title="소속 지급처·기간">
        <select
          className={inputClass}
          value={affiliationId}
          onChange={(event) => {
            const selected = profile.affiliations.find((row) => row.id === event.target.value);
            setAffiliationId(event.target.value);
            setStart(selected?.valid_from ?? '');
          }}
        >
          {profile.affiliations.map((row) => (
            <option key={row.id} value={row.id}>
              {row.business_name} · {row.valid_from} ~ {row.valid_to ?? '현재'}
            </option>
          ))}
        </select>
      </Field>
      <Field title="소속 시작일">
        <input
          className={inputClass}
          type="date"
          required
          value={start}
          max={affiliation?.valid_to ?? undefined}
          onChange={(event) => setStart(event.target.value)}
        />
      </Field>
      <p className="text-sm text-slate-600">
        이미 저장된 운행과 정산 내용은 바뀌지 않습니다. 변경 전후 날짜는 변경 이력에 남습니다.
      </p>
      <Notice error={error} />
      <div className="flex flex-wrap gap-2">
        <button className={buttonClass} disabled={busy || !affiliationId}>
          {busy ? '저장 중…' : '소속 시작일 저장'}
        </button>
        <button className={secondaryClass} type="button" disabled={busy} onClick={onClose}>
          닫기
        </button>
      </div>
    </form>
  );
}
