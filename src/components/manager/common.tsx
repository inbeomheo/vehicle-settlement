'use client';
import Link from 'next/link';
export { ApiError, api, mutate, useRemote } from '@/client/use-remote';
import { secondaryClass } from '@/components/list-controls';
export { inputClass, secondaryClass, Pager } from '@/components/list-controls';
export const buttonClass =
  'inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 active:translate-y-px disabled:cursor-wait disabled:opacity-50';
export const panelClass = 'min-w-0 rounded-lg border border-slate-200 bg-white p-4 sm:p-6';
/** 가장 중요한 한 가지 행동(승인·확정·제출)에만 쓰는 신호 노랑 버튼 */
export const signalClass =
  'inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-signal px-4 py-2 text-sm font-bold text-ink shadow-[0_2px_0_#c99500] hover:bg-signal-strong active:translate-y-px active:shadow-none disabled:cursor-wait disabled:opacity-50';
export function money(value: number | null | undefined) {
  return value == null ? '미확정' : `${value.toLocaleString('ko-KR')}원`;
}
export function dateTime(value: Date | string | null) {
  return value ? new Date(value).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16) : '—';
}
export const labels: Record<string, string> = {
  ADMIN: '관리자',
  SITE_MANAGER: '현장 담당자',
  SETTLEMENT_MANAGER: '정산 담당자',
  DRIVER: '기사',
  ACTIVE: '활성',
  DISABLED: '비활성',
  PER_TRIP: '회당',
  PER_DAY: '일대',
  HALF_DAY: '반일',
  MONTHLY: '월대',
  PER_HOUR: '시간',
  PER_TON: '톤',
  PER_M3: '루베',
  LUMP_SUM: '1식',
  DRAFT: '작성 중',
  SUBMITTED: '제출됨',
  NEEDS_FIX: '보완 요청',
  APPROVED: '승인',
  PENDING: '대기',
  HELD: '보류',
  REJECTED: '반려',
  SUPERSEDED: '이전 승인·제출 (대체됨)',
  PAYABLE: '지급',
  RECEIVABLE: '고객 청구',
  BASE: '기본운임',
  WAITING: '대기료',
  TOLL: '통행료',
  EXTRA_STOP: '경유비',
  CANCEL_FEE: '취소·회차비',
  EXPENSE: '실비',
  OTHER: '기타',
  ADJUSTMENT: '조정',
  CONFIRMED: '확정',
  UNSETTLED: '미정산',
  PARTIAL: '일부 완료',
  SETTLED: '정산 완료',
  NOT_SETTLED: '미정산',
  UNPAID: '미지급',
  PAID: '지급 완료',
  PHOTO: '사진',
  RECEIPT: '인수증',
  WEIGH_TICKET: '계근표',
  CONFIRMATION: '확인서',
  SLIP_NO: '전표번호',
  UPLOADED: '업로드 완료',
  FAILED: '업로드 실패',
  PHOTO_REQUIRED: '파일 증빙 필수',
  PHOTO_OR_ALTERNATIVE: '파일 또는 대체증빙',
  NONE: '증빙 선택',
  CARRIER: '운송사',
  DRIVER_BUSINESS: '기사 사업자',
  CUSTOMER: '고객',
  VAT_EXCLUDED: '부가세 별도',
  VAT_INCLUDED: '부가세 포함',
  TAX_EXEMPT: '면세',
  HALF_UP: '반올림',
  DOWN: '버림',
  UP: '올림',
  PLANNED: '예정',
  IN_PROGRESS: '운행 중',
  COMPLETED: '완료',
  CANCELED: '취소',
  PROXY: '대리 입력',
  DRIVER_SELF: '기사 직접 입력',
  CREATE: '등록',
  UPDATE: '수정',
  CREATE_USE: '사용 등록',
  UPDATE_USE: '사용 수정',
  SUBMIT: '제출',
  APPROVE: '승인',
  REQUEST_FIX: '보완 요청',
  REVIEW_LINE: '비용 검수',
  UPDATE_USER: '사용자 변경',
  ASSIGN_PROJECT: '현장 배정',
  REVOKE_PROJECT: '배정 회수',
  CREATE_RATE: '계약 등록',
  UPDATE_RATE: '계약 변경',
  ADD_RATE_PERIOD: '새 적용기간 추가',
  CLOSE_RATE_PERIOD: '계약 기간 종료',
  vehicle_use: '사용 건',
  charge_line: '비용 항목',
  evidence: '증빙',
  rate_agreement: '계약',
  user: '사용자',
  project_assignment: '현장 배정',
  projects: '현장',
  work_types: '공종',
  counterparties: '거래처',
  drivers: '기사',
  vehicles: '차량',
  driver_affiliations: '기사 소속',
  company_settings: '회사 정보',
  invite: '초대',
  INVITE: '초대 생성',
  CREATE_JOIN_LINK: '기사 가입 링크 생성',
  REVOKE_JOIN_LINK: '기사 가입 링크 끄기',
  REGISTER_DRIVER: '기사 가입',
  UPDATE_DRIVER_PROFILE: '기사 정보 변경',
  UPDATE_DRIVER_AFFILIATION: '기사 소속 시작일 변경',
  DELETE_PROJECT: '현장 삭제',
  driver_join_link: '기사 가입 링크',
  REVOKE_INVITE: '초대 취소',
  ACCEPT_INVITE: '초대 수락',
  LOGIN: '로그인',
  LOGOUT: '로그아웃',
  session: '세션',
};
export const label = (value: string | null | undefined) => (value ? (labels[value] ?? value) : '—');
export function Badge({ value }: { value: string }) {
  const tone = ['APPROVED', 'PAID', 'SETTLED', 'ACTIVE', 'COMPLETED'].includes(value)
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 before:bg-emerald-600'
    : value === 'CANCELED'
      ? 'border-red-200 bg-red-50 text-red-800 before:bg-red-600'
      : ['NEEDS_FIX', 'HELD', 'FAILED', 'DISABLED'].includes(value)
        ? 'border-orange-200 bg-orange-50 text-orange-800 before:bg-orange-600'
        : value === 'SUBMITTED'
          ? 'border-blue-200 bg-blue-50 text-blue-800 before:bg-blue-700'
          : 'border-slate-200 bg-slate-50 text-slate-700 before:bg-slate-400';
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold before:h-1.5 before:w-1.5 before:rounded-full ${tone}`}
    >
      {label(value)}
    </span>
  );
}
export function Notice({
  error,
  success,
  onRetry,
}: {
  error?: string;
  success?: string;
  onRetry?: () => void;
}) {
  return (
    <>
      {error && (
        <div
          role="alert"
          className="my-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
          {onRetry && (
            <button type="button" className={`${secondaryClass} ml-3`} onClick={onRetry}>
              다시 시도
            </button>
          )}
        </div>
      )}
      {success && (
        <div role="status" className="my-4 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900">
          {success}
        </div>
      )}
    </>
  );
}
export function Heading({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-ink sm:text-[1.75rem]">{title}</h1>
        {description && <p className="mt-1.5 text-[0.9375rem] text-slate-600">{description}</p>}
      </div>
      {children}
    </div>
  );
}
export function Field({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <label className="grid min-w-0 gap-1.5 text-sm font-medium text-slate-700">
      <span>{title}</span>
      {children}
    </label>
  );
}
export function Empty({
  loading,
  children = '검색 결과가 없습니다.',
}: {
  loading?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <p role="status" className="px-6 py-12 text-center text-[0.9375rem] text-slate-600">
      {loading ? '불러오는 중…' : children}
    </p>
  );
}
export function UseLink({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <Link
      className="inline-flex min-h-11 items-center font-semibold text-blue-800 underline"
      href={`/m/uses/${id}`}
    >
      {children}
    </Link>
  );
}
