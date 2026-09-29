'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
export const inputClass =
  'w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm disabled:bg-slate-100';
export const buttonClass =
  'inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-wait disabled:opacity-50';
export const secondaryClass =
  'inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50';
export const panelClass = 'min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-6';
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
  REVOKE_INVITE: '초대 취소',
  ACCEPT_INVITE: '초대 수락',
  LOGIN: '로그인',
  LOGOUT: '로그아웃',
  session: '세션',
};
export const label = (value: string | null | undefined) => (value ? (labels[value] ?? value) : '—');
export function Badge({ value }: { value: string }) {
  const color = ['APPROVED', 'PAID', 'SETTLED', 'ACTIVE', 'COMPLETED'].includes(value)
    ? 'bg-emerald-50 text-emerald-800'
    : ['NEEDS_FIX', 'HELD', 'FAILED', 'DISABLED'].includes(value)
      ? 'bg-amber-50 text-amber-900'
      : 'bg-slate-100 text-slate-700';
  return (
    <span className={`inline-block whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold ${color}`}>
      {label(value)}
    </span>
  );
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    cache: 'no-store',
    ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers },
  });
  const body = await response.json();
  if (!response.ok) {
    const details = Array.isArray(body.error?.details)
      ? body.error.details
          .map((item: { message?: string }) => item.message)
          .filter(Boolean)
          .join(' ')
      : '';
    throw new ApiError(
      `${body.error?.message ?? '요청에 실패했습니다.'}${details ? ' ' + details : ''}`,
      response.status,
    );
  }
  return body.data;
}
export function mutate<T>(url: string, method: string, data: unknown = {}) {
  return api<T>(url, {
    method,
    body: JSON.stringify(data),
    headers: { 'idempotency-key': crypto.randomUUID() },
  });
}
export function useRemote<T>(url: string | null) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!url) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    api<T>(url, { signal: controller.signal })
      .then(setData)
      .catch((reason: Error) => {
        if (!controller.signal.aborted) {
          setError(reason.message);
          setData(undefined);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [url, revision]);
  return { data, error, loading, refresh };
}
export function Notice({ error, success }: { error?: string; success?: string }) {
  return (
    <>
      {error && (
        <div
          role="alert"
          className="my-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
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
        <p className="mb-1 text-xs font-semibold tracking-widest text-slate-500">차량 운영</p>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-2 text-sm text-slate-600">{description}</p>}
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
    <p role="status" className="p-8 text-center text-sm text-slate-500">
      {loading ? '불러오는 중…' : children}
    </p>
  );
}
export function Pager({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
      <span>
        전체 {total.toLocaleString('ko-KR')}건 · {page} / {Math.max(1, Math.ceil(total / pageSize))}페이지
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          className={secondaryClass}
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          이전
        </button>
        <button
          type="button"
          className={secondaryClass}
          disabled={page * pageSize >= total}
          onClick={() => onChange(page + 1)}
        >
          다음
        </button>
      </div>
    </div>
  );
}
export function UseLink({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <Link className="font-semibold text-blue-800 underline" href={`/m/uses/${id}`}>
      {children}
    </Link>
  );
}
