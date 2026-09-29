import type { Context } from '../context';

type Role = Context['user']['role'];
export const managerMenu = [
  { href: '/m', title: '대시보드' },
  { href: '/m/review', title: '검수함' },
  { href: '/m/ledger', title: '차량 사용대장' },
  { href: '/m/uses/new', title: '대리 입력' },
  { href: '/m/statements', title: '월 정산' },
  { href: '/m/payments', title: '지급 관리' },
  { href: '/m/import', title: '엑셀 가져오기' },
  { href: '/m/master', title: '기준정보' },
  { href: '/m/users', title: '사용자 관리' },
  { href: '/m/audit', title: '변경 이력' },
] as const;

export function canSettle(role: Role) {
  return role === 'ADMIN' || role === 'SETTLEMENT_MANAGER';
}

export function canAccessManagerPage(role: Role, pathname: string) {
  if (role === 'DRIVER') return false;
  const section = pathname.split('/')[2];
  if (['master', 'users'].includes(section)) return role === 'ADMIN';
  if (['statements', 'payments'].includes(section)) return canSettle(role);
  return true;
}
