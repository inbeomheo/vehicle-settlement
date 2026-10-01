export const approvalLabels: Record<string, string> = {
  ALL: '전체',
  DRAFT: '작성중',
  SUBMITTED: '검수대기',
  NEEDS_FIX: '반려',
  APPROVED: '결재완료',
};
export const approvalStatuses = ['ALL', 'DRAFT', 'SUBMITTED', 'NEEDS_FIX', 'APPROVED'] as const;
export function shiftDay(value: string, offset: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
}
