import type { getUse, listUses } from '@/server/services/uses';
import type { getLookups } from '@/server/services/lookups';
import type { lookupRate } from '@/server/services/rates';
import type { publicUser } from '@/server/auth/session';

type Json<T> = T extends Date ? string : T extends object ? { [K in keyof T]: Json<T[K]> } : T;
export type UseDetail = Json<Awaited<ReturnType<typeof getUse>>>;
export type UseList = Json<Awaited<ReturnType<typeof listUses>>>;
export type Lookups = Json<Awaited<ReturnType<typeof getLookups>>>;
export type RateResult = Json<Awaited<ReturnType<typeof lookupRate>>>;
export type User = Json<ReturnType<typeof publicUser>>;
export type Mode = 'driver' | 'manager';
export const units = {
  PER_TRIP: '회당·건당',
  PER_DAY: '일대',
  HALF_DAY: '반일',
  MONTHLY: '월대',
  PER_HOUR: '시간',
  PER_TON: '톤',
  PER_M3: '루베',
  LUMP_SUM: '1식',
};
export const chargeKinds = {
  BASE: '기본운임',
  WAITING: '대기료',
  TOLL: '통행료',
  EXTRA_STOP: '경유비',
  CANCEL_FEE: '취소·회차비',
  EXPENSE: '실비',
  OTHER: '기타',
};
export const evidenceKinds = {
  PHOTO: '사진',
  RECEIPT: '인수증',
  WEIGH_TICKET: '계근표',
  CONFIRMATION: '확인서',
  OTHER: '기타',
  SLIP_NO: '전표번호',
};
export const reviewLabels = {
  DRAFT: '작성 중 · 아직 안 보냄',
  SUBMITTED: '보냄 · 확인 기다림',
  NEEDS_FIX: '고쳐서 다시 보내기',
  APPROVED: '승인됨',
};
export const operationLabels = {
  PLANNED: '예정',
  IN_PROGRESS: '운행 중',
  COMPLETED: '완료',
  CANCELED: '취소',
};
export function todaySeoul() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
export function money(value: number | null | undefined) {
  return value == null ? '단가 미확정' : `${value.toLocaleString('ko-KR')}원`;
}
