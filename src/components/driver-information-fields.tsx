'use client';
import { Field, Section, control } from '@/components/use-form/fields';
import { inputClass } from '@/components/manager/common';

export type DriverInformationValues = {
  name: string;
  phone: string;
  business_name: string;
  biz_no: string;
  representative_name: string;
  address: string;
  business_type: string;
  business_item: string;
  plate_no: string;
  vehicle_type: string;
  tonnage: string;
};
export const emptyDriverInformation: DriverInformationValues = {
  name: '',
  phone: '',
  business_name: '',
  biz_no: '',
  representative_name: '',
  address: '',
  business_type: '운수',
  business_item: '화물',
  plate_no: '',
  vehicle_type: '카고',
  tonnage: '',
};
export function formatBusinessNumber(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  return digits.length > 5
    ? `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`
    : digits.length > 3
      ? `${digits.slice(0, 3)}-${digits.slice(3)}`
      : digits;
}
export function DriverInformationFields({
  value,
  onChange,
  manager = false,
  joining = false,
  business,
  businessDetailsReadOnly = false,
}: {
  value: DriverInformationValues;
  onChange: (value: DriverInformationValues) => void;
  manager?: boolean;
  joining?: boolean;
  businessDetailsReadOnly?: boolean;
  business?: { name: string; masked_biz_no: string } | null;
}) {
  const className = manager ? inputClass : control;
  function field(
    key: keyof DriverInformationValues,
    title: string,
    extra: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) {
    return (
      <Field label={title}>
        <input
          className={className}
          name={key}
          required
          maxLength={200}
          value={value[key]}
          onChange={(e) =>
            onChange({
              ...value,
              [key]: key === 'biz_no' ? formatBusinessNumber(e.target.value) : e.target.value,
            })
          }
          {...extra}
        />
      </Field>
    );
  }
  return (
    <div className="space-y-4">
      <Section title="내 정보" step={1}>
        <div className="grid gap-4 sm:grid-cols-2">
          {field('name', '이름', { autoComplete: 'name' })}
          {field('phone', '전화번호', { type: 'tel', autoComplete: 'tel', placeholder: '010-1234-5678' })}
        </div>
      </Section>
      <Section title="사업자 정보" step={2}>
        {business ? (
          <p className="break-words font-semibold">
            소속: {business.name}({business.masked_biz_no})
          </p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              {field('business_name', '상호명', { autoComplete: 'organization' })}
              {field('biz_no', '사업자번호', {
                inputMode: 'numeric',
                maxLength: 12,
                placeholder: '000-00-00000',
                pattern: '[0-9]{3}-[0-9]{2}-[0-9]{5}',
              })}
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {field('representative_name', '대표자 (선택)', {
                required: false,
                maxLength: 200,
                readOnly: businessDetailsReadOnly,
              })}
              {field('address', '사업장 주소 (선택)', {
                required: false,
                maxLength: 500,
                readOnly: businessDetailsReadOnly,
              })}
              {field('business_type', '업태 (선택)', {
                required: false,
                maxLength: 100,
                readOnly: businessDetailsReadOnly,
              })}
              {field('business_item', '종목 (선택)', {
                required: false,
                maxLength: 100,
                readOnly: businessDetailsReadOnly,
              })}
            </div>
            {businessDetailsReadOnly && (
              <p className="mt-3 text-sm text-slate-600">
                공유 운송사 사업자 정보는 관리자에게 수정을 요청해 주세요.
              </p>
            )}
            <p className="mt-3 text-sm text-slate-600">
              {joining
                ? '같은 사업자로 이미 등록된 차량이 있으면 관리자에게 기사 추가(개별 초대)를 요청해 주세요.'
                : manager
                  ? '기존 사업자로 연결하면 해당 사업자 정보를 사용합니다.'
                  : '등록된 다른 사업자로 변경하려면 관리자에게 문의해 주세요.'}
            </p>
          </>
        )}
      </Section>
      <Section title="차량 정보" step={3}>
        <div className="grid gap-4 sm:grid-cols-2">
          {field('plate_no', '차량번호', { placeholder: '서울80아1234' })}
          <Field label="차종">
            <select
              className={className}
              value={value.vehicle_type}
              onChange={(e) => onChange({ ...value, vehicle_type: e.target.value })}
            >
              {[
                '카고',
                '덤프',
                '트레일러',
                '윙바디',
                '탑차',
                '크레인',
                '기타',
                ...(!['카고', '덤프', '트레일러', '윙바디', '탑차', '크레인', '기타'].includes(
                  value.vehicle_type,
                )
                  ? [value.vehicle_type]
                  : []),
              ].map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </Field>
          {field('tonnage', '차량 최대 적재 (톤)', {
            inputMode: 'decimal',
            placeholder: '예: 8',
            pattern: '[0-9]+(\\.[0-9]{1,3})?',
          })}
        </div>
        <p className="mt-3 text-sm text-slate-600">
          차량이 실을 수 있는 최대 무게입니다. 운행 때 싣는 무게는 운행 등록에서 입력합니다.
        </p>
      </Section>
    </div>
  );
}
