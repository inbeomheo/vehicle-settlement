'use client';
import { useState } from 'react';
import {
  Empty,
  Field,
  Heading,
  Notice,
  Pager,
  buttonClass,
  dateTime,
  inputClass,
  label,
  money,
  panelClass,
  useRemote,
} from './common';
import { queryString, type Search } from './ledger';
type AuditRow = {
  id: string;
  at: string;
  user_name: string | null;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_no?: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
};
type Result = {
  rows: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
  user_options: { id: string; name: string }[];
};
const auditLabels: Record<string, string> = {
  IMPORT_UPLOAD: '가져오기 파일 등록',
  IMPORT_ROW: '가져오기 사용 등록',
  IMPORT_COMMIT: '가져오기 저장',
  IMPORT_PRESET: '가져오기 매핑 저장',
  IMPORT_PREVIEW_DELETE: '미확정 미리보기 삭제',
  PAYMENT_RECORD: '지급·입금 기록',
  PAYMENT_VOID: '지급·입금 기록 취소',
  STATEMENT_CREATE: '명세 작성',
  STATEMENT_UPDATE: '명세 수정',
  STATEMENT_CONFIRM: '명세 확정',
  STATEMENT_CANCEL: '명세 취소',
  ADJUSTMENT_CREATE: '조정 비용 등록',
  DRIVER_CONFIRM: '기사 확인',
  CANCEL: '사용 취소',
  COPY: '사용 복사',
  CREATE_EVIDENCE: '증빙 등록',
  UPLOAD: '증빙 업로드',
  UPLOAD_FAILED: '증빙 업로드 실패',
  REPLACE_EVIDENCE: '증빙 교체',
  DELETE_EVIDENCE: '증빙 삭제',
  import_job: '가져오기 작업',
  import_preset: '가져오기 매핑',
  payment: '지급·입금',
  statement: '정산명세',
  PREVIEW: '미리보기',
  COMMITTED: '저장 완료',
  INCLUDED: '포함',
  PAYMENT: '지급',
  IMPORT: '엑셀 가져오기',
  VALID: '유효',
  ERROR: '오류',
  SKIPPED: '건너뜀',
};
export const auditLabel = (value: string) => auditLabels[value] ?? label(value);
const fieldLabels: Record<string, string> = {
  name: '이름',
  phone: '연락처',
  login_id: '아이디',
  role: '역할',
  status: '상태',
  use_no: '사용번호',
  use_date: '사용일',
  end_date: '종료일',
  project_id: '현장',
  driver_id: '기사',
  vehicle_id: '차량',
  work_type_id: '공종',
  requester: '요청자',
  payee_counterparty_id: '지급처',
  customer_counterparty_id: '고객',
  counterparty_id: '거래처',
  cargo_desc: '운반 내용',
  notes: '비고',
  snapshot: '당시 정보',
  trips: '운행',
  charge_lines: '비용',
  evidence: '증빙',
  revisions: '검수 이력',
  operation_status: '운행 상태',
  review_status: '검수 상태',
  current_revision_no: '제출 차수',
  approved_revision_id: '승인 제출본',
  created_by_user_id: '작성자',
  entered_as: '입력 구분',
  driver_confirmed_at: '기사 확인 시각',
  seq: '회차',
  origin: '출발지',
  destination: '도착지',
  via: '경유지',
  depart_at: '출발 시각',
  arrive_at: '도착 시각',
  quantity: '수량',
  quantity_unit: '수량 단위',
  hours: '시간',
  is_empty_return: '공차 회송',
  direction: '방향',
  charge_type: '비용 종류',
  billing_unit: '과금단위',
  unit_price: '단가',
  rate_agreement_id: '계약',
  rate_basis_date: '단가 적용일',
  agreement_snapshot: '계약 당시 정보',
  tax_mode: '세금',
  rounding: '원 단위 처리',
  min_charge: '최소요금',
  computed_amount: '계산액',
  requested_amount: '요청액',
  approved_amount: '승인 공급가',
  tax_amount: '세액',
  price_status: '단가 상태',
  line_review_status: '비용 검수 상태',
  reason: '사유',
  included_in_base: '기본운임 포함',
  adjusts_statement_id: '조정 원명세',
  locked_statement_id: '확정 명세',
  deleted_at: '삭제 시각',
  kind: '구분',
  original_name: '파일 이름',
  mime: '파일 형식',
  size: '파일 크기',
  text_value: '대체증빙',
  upload_status: '업로드 상태',
  uploaded_by: '업로드 사용자',
  uploaded_at: '업로드 시각',
  replace_reason: '교체 사유',
  replaced_by_id: '교체 증빙',
  revision_no: '제출 차수',
  submitted_by: '제출자',
  submitted_at: '제출 시각',
  decision: '검수 결정',
  decided_by: '검수자',
  decided_at: '검수 시각',
  comment: '의견',
  fix_items: '보완 항목',
  target: '보완 대상',
  message: '내용',
  statement_no: '명세번호',
  period_start: '기간 시작',
  period_end: '기간 종료',
  title: '제목',
  counterparty_snapshot: '거래처 당시 정보',
  issuer_snapshot: '발행 회사 정보',
  supply_total: '공급가 합계',
  tax_total: '세액 합계',
  grand_total: '총액',
  due_date: '예정일',
  confirmed_at: '확정 시각',
  confirmed_by: '확정자',
  canceled_at: '취소 시각',
  canceled_by: '취소자',
  cancel_reason: '취소 사유',
  created_by: '작성자',
  replaces_statement_id: '이전 명세',
  items: '명세 항목',
  inclusion: '포함 여부',
  hold_reason: '보류 사유',
  supply_amount: '공급가',
  is_active_lock: '확정 잠금',
  amount: '금액',
  paid_on: '지급·입금일',
  method: '방법',
  reference: '참고번호',
  memo: '메모',
  recorded_by: '기록자',
  recorded_at: '기록 시각',
  voided_at: '기록 취소 시각',
  voided_by: '취소자',
  void_reason: '기록 취소 사유',
  file_name: '파일 이름',
  mapping: '열 매핑',
  summary: '결과',
  rows: '행',
  committed_at: '저장 시각',
  all_projects: '모든 현장 접근',
  active: '사용 중',
  valid_from: '적용 시작일',
  valid_to: '적용 종료일',
  revoked_at: '취소 시각',
  expires_at: '만료 시각',
  used_at: '수락 시각',
  used_by_user_id: '수락 사용자',
  project_ids: '배정 현장',
  code: '코드',
  evidence_policy: '증빙 정책',
  biz_no: '사업자번호',
  contact_name: '담당자',
  bank_account: '계좌',
  default_vehicle_id: '기본 차량',
  plate_no: '차량번호',
  vehicle_type: '차종',
  tonnage: '톤수',
  address: '주소',
  representative: '대표자',
  default_tax_mode: '기본 세금',
  settlement_contact: '정산 연락처',
  project_name: '현장명',
  driver_name: '기사명',
  driver_phone: '기사 연락처',
  payee_name: '지급처명',
  customer_name: '고객명',
  completed_trip_count: '완료 운행 수',
  trip_count: '운행 수',
  success: '성공',
  failed: '실패',
  total: '전체',
  valid: '유효',
  invalid: '오류',
  skipped: '건너뜀',
  duplicate: '중복',
  imported: '가져온 건수',
  job_id: '가져오기 작업',
  row_number: '행 번호',
  row: '행 번호',
  import_job_id: '가져오기 작업',
  imported_unit_price: '가져온 단가',
  contract_unit_price: '계약 단가',
  applied_contract_rate: '계약 단가 적용',
  apply_contract_rate: '빈 단가에 계약 단가 적용',
  errors: '오류',
  warnings: '주의 사항',
  source: '등록 경로',
  sheet: '시트',
  sheet_index: '시트 번호',
  header_row: '제목 행',
  columns: '열 매핑',
  excluded_rows: '제외 행',
  use_id: '사용 건',
  id: '식별번호',
  user_id: '사용자',
  vehicle_use_id: '사용 건',
  statement_id: '명세',
  trip_id: '운행',
  charge_line_id: '비용 항목',
  source_id: '복사 원본',
};
const omittedFields = new Set([
  'id',
  'created_at',
  'updated_at',
  'version',
  'client_request_id',
  'client_row_id',
  'source_row_hash',
  'sha256',
  'password_hash',
  'token_hash',
  'storage_key',
  'invite_url',
]);
type Change = { key: string; title: string; before: unknown; after: unknown };
export function auditChanges(before: unknown, after: unknown, path: string[] = []): Change[] {
  if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) return [];
  const beforeObject = before !== null && typeof before === 'object';
  const afterObject = after !== null && typeof after === 'object';
  if (beforeObject || afterObject) {
    const left = beforeObject ? (before as Record<string, unknown>) : {};
    const right = afterObject ? (after as Record<string, unknown>) : {};
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap((key) =>
      omittedFields.has(key) ? [] : auditChanges(left[key], right[key], [...path, key]),
    );
  }
  return [
    {
      key: path.join('.'),
      title:
        path
          .map((key) => (/^\d+$/.test(key) ? `${Number(key) + 1}번째` : (fieldLabels[key] ?? '기타 항목')))
          .join(' · ') || '내용',
      before,
      after,
    },
  ];
}
const moneyFields = new Set([
  'amount',
  'unit_price',
  'min_charge',
  'computed_amount',
  'requested_amount',
  'approved_amount',
  'tax_amount',
  'supply_amount',
  'supply_total',
  'tax_total',
  'grand_total',
  'imported_unit_price',
  'contract_unit_price',
]);
export function auditValue(value: unknown, key: string, entityType?: string) {
  if (value === null || value === undefined || value === '') return '없음';
  if (typeof value === 'boolean') return value ? '예' : '아니요';
  const field = key.split('.').at(-1)!;
  if (typeof value === 'number' && moneyFields.has(field)) return money(value);
  if (field === 'kind' && value === 'RECEIPT' && entityType === 'payment') return '입금';
  if (typeof value === 'string' && field.endsWith('_at') && !Number.isNaN(Date.parse(value)))
    return dateTime(value);
  return auditLabel(String(value));
}
function ChangeTable({ changes, entityType }: { changes: Change[]; entityType?: string }) {
  return (
    <table className="w-full table-fixed text-left text-sm">
      <thead>
        <tr className="border-b border-slate-200">
          <th className="w-1/3 py-2">변경 항목</th>
          <th className="py-2">이전 → 이후</th>
        </tr>
      </thead>
      <tbody>
        {changes.map((change) => (
          <tr key={change.key} className="border-b border-slate-100">
            <th className="py-3 pr-3 align-top font-medium break-words">{change.title}</th>
            <td className="py-3 break-words">
              <span className="text-slate-500">{auditValue(change.before, change.key, entityType)}</span>
              <span className="mx-2" aria-label="에서">
                →
              </span>
              <span>{auditValue(change.after, change.key, entityType)}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
export function AuditChanges({
  before,
  after,
  entityType,
}: {
  before: unknown;
  after: unknown;
  entityType?: string;
}) {
  const changes = auditChanges(before, after);
  if (!changes.length) return <p className="mt-3 text-sm text-slate-500">변경된 세부 항목이 없습니다.</p>;
  return (
    <div className="mt-3">
      <ChangeTable changes={changes.slice(0, 6)} entityType={entityType} />
      {changes.length > 6 && (
        <details>
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-blue-800">
            변경 항목 {changes.length - 6}개 더 보기
          </summary>
          <ChangeTable changes={changes.slice(6)} entityType={entityType} />
        </details>
      )}
    </div>
  );
}
export function AuditPanel({ useId }: { useId?: string }) {
  const [query, setQuery] = useState<Search>({ page: '1', ...(useId ? { use_id: useId } : {}) });
  const [draft, setDraft] = useState<Search>({});
  const { data, error, loading } = useRemote<Result>(`/api/audit?${queryString(query)}`);
  const change = (key: string, value: string) => setDraft((previous) => ({ ...previous, [key]: value }));
  return (
    <>
      {!useId && (
        <Heading
          title="변경 이력"
          description="담당자는 접근 가능한 사용 건·비용·증빙의 이력만 조회할 수 있습니다."
        />
      )}
      <form
        className={`${panelClass} mb-4 grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-5`}
        onSubmit={(e) => {
          e.preventDefault();
          setQuery({ ...draft, page: '1', ...(useId ? { use_id: useId } : {}) });
        }}
      >
        <Field title="대상 유형">
          <select
            className={inputClass}
            value={draft.entity_type ?? ''}
            onChange={(e) => change('entity_type', e.target.value)}
          >
            <option value="">전체</option>
            {[
              'vehicle_use',
              'charge_line',
              'evidence',
              'rate_agreement',
              'projects',
              'work_types',
              'counterparties',
              'drivers',
              'vehicles',
              'driver_affiliations',
              'user',
              'project_assignment',
              'invite',
              'company_settings',
              'statement',
              'payment',
              'import_job',
              'import_preset',
              'session',
            ].map((value) => (
              <option key={value} value={value}>
                {auditLabel(value)}
              </option>
            ))}
          </select>
        </Field>
        <Field title="사용자">
          <select
            className={inputClass}
            value={draft.user_id ?? ''}
            onChange={(e) => change('user_id', e.target.value)}
          >
            <option value="">전체 사용자</option>
            {data?.user_options?.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </Field>
        <Field title="시작일">
          <input
            type="date"
            className={inputClass}
            value={draft.from ?? ''}
            onChange={(e) => change('from', e.target.value)}
          />
        </Field>
        <Field title="종료일">
          <input
            type="date"
            className={inputClass}
            value={draft.to ?? ''}
            onChange={(e) => change('to', e.target.value)}
          />
        </Field>
        <button className={buttonClass}>이력 조회</button>
        {!useId && (
          <Field title="사용번호·명세번호 검색">
            <input
              className={inputClass}
              placeholder="U-2609 또는 PAY-202609"
              value={draft.search ?? ''}
              onChange={(e) => change('search', e.target.value)}
            />
          </Field>
        )}
        <details className="sm:col-span-2 lg:col-span-5">
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">고급 옵션</summary>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field title="사용자 ID (고급)">
              <input
                className={inputClass}
                placeholder="사용자 UUID"
                value={draft.user_id ?? ''}
                onChange={(e) => change('user_id', e.target.value)}
              />
            </Field>
            {!useId && (
              <Field title="대상 ID (고급)">
                <input
                  className={inputClass}
                  placeholder="대상 UUID"
                  value={draft.entity_id ?? ''}
                  onChange={(e) => change('entity_id', e.target.value)}
                />
              </Field>
            )}
          </div>
        </details>
      </form>
      <Notice error={error} />
      <div className="grid gap-3">
        {!loading &&
          data?.rows.map((row) => (
            <article className={panelClass} key={row.id}>
              <div>
                <span className="font-semibold">{auditLabel(row.action)}</span>
                <span className="ml-3 text-sm text-slate-500">
                  {dateTime(row.at)} · {row.user_name ?? '시스템'} · {auditLabel(row.entity_type)}
                </span>
              </div>
              {row.entity_no && <p className="mt-2 text-sm font-semibold">{row.entity_no}</p>}
              {row.reason && <p className="mt-2 text-sm">사유: {row.reason}</p>}
              <AuditChanges before={row.before} after={row.after} entityType={row.entity_type} />
              <details className="mt-3 text-xs text-slate-500">
                <summary className="min-h-11 cursor-pointer py-3">식별번호 보기</summary>
                <p className="break-all">
                  대상 {row.entity_id ?? '없음'} · 사용자 {row.user_id ?? '없음'}
                </p>
              </details>
            </article>
          ))}
      </div>
      {(loading || !data?.rows.length) && <Empty loading={loading}>변경 이력이 없습니다.</Empty>}
      {data && (
        <Pager
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          onChange={(page) => setQuery({ ...query, page: String(page) })}
        />
      )}
    </>
  );
}
