'use client';
import { Field, inputClass, Notice, useRemote } from './common';
import { formatBusinessNumber } from '../driver-information-fields';

export type JoinBusinessSelection = {
  mode: 'existing' | 'new';
  counterpartyId: string;
  name: string;
  bizNo: string;
  representative_name: string;
  address: string;
  business_type: string;
  business_item: string;
};
export const emptyJoinBusiness: JoinBusinessSelection = {
  mode: 'existing',
  counterpartyId: '',
  name: '',
  bizNo: '',
  representative_name: '',
  address: '',
  business_type: '운수',
  business_item: '화물',
};
export function joinBusinessPayload(value: JoinBusinessSelection) {
  return value.mode === 'new'
    ? {
        new_business: {
          name: value.name,
          biz_no: value.bizNo,
          representative_name: value.representative_name,
          address: value.address,
          business_type: value.business_type,
          business_item: value.business_item,
        },
      }
    : { counterparty_id: value.counterpartyId || null };
}
export function JoinBusinessFields({
  value,
  onChange,
  disabled = false,
}: {
  value: JoinBusinessSelection;
  onChange: (value: JoinBusinessSelection) => void;
  disabled?: boolean;
}) {
  const parties =
    useRemote<{ id: string; name: string; biz_no: string | null; kind: string; active: boolean }[]>(
      '/api/admin/counterparties',
    );
  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="mb-2 font-semibold">소속 사업자 지정 (선택)</legend>
      <p className="text-sm text-slate-600">
        같은 운송사 기사 여러 명이 가입하려면 소속 사업자를 지정하세요.
      </p>
      <div role="tablist" aria-label="소속 사업자 등록 방법" className="flex flex-wrap gap-2">
        {(['existing', 'new'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={value.mode === mode}
            className={`inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2 text-sm ${value.mode === mode ? 'border-ink bg-ink font-bold text-white hover:bg-slate-700' : 'border-slate-300 bg-white font-medium text-ink hover:bg-slate-50'}`}
            onClick={() => onChange({ ...value, mode })}
          >
            {mode === 'existing' ? '기존 사업자 선택' : '새 사업자 등록'}
          </button>
        ))}
      </div>
      {value.mode === 'existing' ? (
        <>
          <Notice error={parties.error} onRetry={parties.refresh} />
          <Field title="소속 사업자">
            <select
              className={inputClass}
              value={value.counterpartyId}
              disabled={parties.loading}
              onChange={(e) => onChange({ ...value, counterpartyId: e.target.value })}
            >
              <option value="">지정 안 함 (가입자가 새 사업자 등록)</option>
              {parties.data
                ?.filter((p) => p.active && ['DRIVER_BUSINESS', 'CARRIER'].includes(p.kind))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.biz_no ? ` (${p.biz_no})` : ''}
                  </option>
                ))}
            </select>
          </Field>
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field title="소속 사업자 상호">
            <input
              className={inputClass}
              required
              maxLength={200}
              value={value.name}
              onChange={(e) => onChange({ ...value, name: e.target.value })}
            />
          </Field>
          <Field title="소속 사업자번호">
            <input
              className={inputClass}
              required
              inputMode="numeric"
              maxLength={12}
              pattern="[0-9]{3}-[0-9]{2}-[0-9]{5}"
              placeholder="000-00-00000"
              value={value.bizNo}
              onChange={(e) => onChange({ ...value, bizNo: formatBusinessNumber(e.target.value) })}
            />
          </Field>
          {(
            [
              ['representative_name', '대표자 (선택)', 200],
              ['address', '사업장 주소 (선택)', 500],
              ['business_type', '업태 (선택)', 100],
              ['business_item', '종목 (선택)', 100],
            ] as const
          ).map(([key, title, maxLength]) => (
            <Field key={key} title={title}>
              <input
                className={inputClass}
                value={value[key]}
                maxLength={maxLength}
                onChange={(e) => onChange({ ...value, [key]: e.target.value })}
              />
            </Field>
          ))}
        </div>
      )}
      <p className="text-sm text-slate-600">
        지정한 사업자는 가입할 때 표시만 되며, 기사님은 이름·연락처·차량·로그인 정보를 입력합니다.
      </p>
    </fieldset>
  );
}
