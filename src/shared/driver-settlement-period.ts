import { z } from 'zod';

export const driverSettlementPeriodSchema = z
  .object({
    periodStart: z.iso.date('시작일을 확인해 주세요.'),
    periodEnd: z.iso.date('종료일을 확인해 주세요.'),
  })
  .refine((value) => value.periodStart <= value.periodEnd, '종료일은 시작일보다 빠를 수 없습니다.')
  .refine((value) => {
    const anniversary = new Date(`${value.periodStart}T00:00:00Z`);
    if (!Number.isFinite(anniversary.getTime())) return false;
    anniversary.setUTCFullYear(anniversary.getUTCFullYear() + 1);
    return value.periodEnd < anniversary.toISOString().slice(0, 10);
  }, '기간은 최대 1년까지 고를 수 있습니다.');
