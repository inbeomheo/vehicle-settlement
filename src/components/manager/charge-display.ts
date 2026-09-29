const chargeTypes: Record<string, string> = {
  BASE: '기본운임',
  WAITING: '대기료',
  TOLL: '통행료',
  EXTRA_STOP: '경유비',
  CANCEL_FEE: '취소·회차비',
  EXPENSE: '실비',
  OTHER: '기타',
  ADJUSTMENT: '조정',
};
const units: Record<string, string> = {
  PER_TRIP: '회당',
  PER_DAY: '일대',
  HALF_DAY: '반일',
  MONTHLY: '월대',
  PER_HOUR: '시간',
  PER_TON: '톤',
  PER_M3: '루베',
  LUMP_SUM: '1식',
};
export function chargeTypeLabel(type?: string | null) {
  return type ? (chargeTypes[type] ?? '—') : '—';
}
export function chargeUnitLabel(type?: string | null, unit?: string | null) {
  if (type && type !== 'BASE' && !['PER_HOUR', 'PER_TON', 'PER_M3'].includes(unit ?? '')) return '건';
  return unit ? (units[unit] ?? '—') : '—';
}
