export type MasterField = {
  key: string;
  title: string;
  type?: 'text' | 'number' | 'date' | 'select' | 'boolean';
  required?: boolean;
  options?: string[];
  source?: string;
  step?: string;
};
export type MasterConfig = { title: string; fields: MasterField[] };
const name: MasterField = { key: 'name', title: '이름', required: true };
const active: MasterField = { key: 'active', title: '사용 중', type: 'boolean' };
const dateFields: MasterField[] = [
  { key: 'valid_from', title: '적용 시작일', type: 'date', required: true },
  { key: 'valid_to', title: '적용 종료일', type: 'date' },
];
export const masterConfigs: Record<string, MasterConfig> = {
  projects: {
    title: '현장',
    fields: [
      { key: 'name', title: '현장(프로젝트) 이름 (예: 탕정)', required: true },
      { key: 'code', title: '현장 코드 (선택, 비우면 자동)' },
      {
        key: 'evidence_policy',
        title: '증빙 정책',
        type: 'select',
        options: ['NONE', 'PHOTO_REQUIRED', 'PHOTO_OR_ALTERNATIVE'],
        required: true,
      },
      active,
    ],
  },
  'work-types': { title: '공종', fields: [name, active] },
  counterparties: {
    title: '거래처',
    fields: [
      name,
      {
        key: 'kind',
        title: '구분',
        type: 'select',
        options: ['CARRIER', 'DRIVER_BUSINESS', 'CUSTOMER'],
        required: true,
      },
      { key: 'biz_no', title: '사업자번호' },
      { key: 'contact_name', title: '담당자' },
      { key: 'phone', title: '연락처' },
      { key: 'bank_account', title: '계좌' },
      active,
    ],
  },
  drivers: {
    title: '기사',
    fields: [
      name,
      { key: 'phone', title: '연락처' },
      { key: 'default_vehicle_id', title: '기본차량', type: 'select', source: 'vehicles' },
      active,
    ],
  },
  affiliations: {
    title: '기사 소속 기간',
    fields: [
      { key: 'driver_id', title: '기사', type: 'select', source: 'drivers', required: true },
      {
        key: 'counterparty_id',
        title: '소속 지급처',
        type: 'select',
        source: 'counterparties',
        required: true,
      },
      ...dateFields,
    ],
  },
  vehicles: {
    title: '차량',
    fields: [
      { key: 'plate_no', title: '차량번호', required: true },
      { key: 'vehicle_type', title: '차종', required: true },
      { key: 'tonnage', title: '톤수', type: 'number', step: '0.001', required: true },
      active,
    ],
  },
  rates: {
    title: '계약·단가',
    fields: [
      name,
      { key: 'direction', title: '방향', type: 'select', options: ['PAYABLE', 'RECEIVABLE'], required: true },
      { key: 'counterparty_id', title: '거래처', type: 'select', source: 'counterparties', required: true },
      { key: 'project_id', title: '현장 (미선택: 전 현장)', type: 'select', source: 'projects' },
      { key: 'vehicle_type', title: '차종 (미입력: 전체)' },
      { key: 'tonnage', title: '톤수 (미입력: 전체)', type: 'number', step: '0.001' },
      {
        key: 'billing_unit',
        title: '과금단위',
        type: 'select',
        options: ['PER_TRIP', 'PER_DAY', 'HALF_DAY', 'MONTHLY', 'PER_HOUR', 'PER_TON', 'PER_M3', 'LUMP_SUM'],
        required: true,
      },
      { key: 'unit_price', title: '단가 (원)', type: 'number', required: true },
      ...dateFields,
      {
        key: 'tax_mode',
        title: '세금',
        type: 'select',
        options: ['VAT_EXCLUDED', 'VAT_INCLUDED', 'TAX_EXEMPT'],
        required: true,
      },
      {
        key: 'rounding',
        title: '원 단위 처리',
        type: 'select',
        options: ['HALF_UP', 'DOWN', 'UP'],
        required: true,
      },
      { key: 'min_charge', title: '최소요금 (원)', type: 'number' },
      { key: 'notes', title: '비고' },
      active,
    ],
  },
  company: {
    title: '회사 정보',
    fields: [
      { ...name, title: '회사명' },
      { key: 'biz_no', title: '사업자번호' },
      { key: 'address', title: '주소' },
      { key: 'representative', title: '대표자' },
      { key: 'settlement_contact', title: '정산 담당 연락처' },
      {
        key: 'default_tax_mode',
        title: '기본 세금',
        type: 'select',
        options: ['VAT_EXCLUDED', 'VAT_INCLUDED', 'TAX_EXEMPT'],
        required: true,
      },
    ],
  },
};
