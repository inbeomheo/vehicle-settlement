import Decimal from 'decimal.js';
import { z } from 'zod';

const name = z.string().trim().min(1).max(200);
export const driverInformationSchema = z
  .object({
    name,
    phone: z
      .string()
      .trim()
      .regex(/^[0-9 -]+$/)
      .transform((value) => value.replace(/\D/g, ''))
      .refine((value) => /^0\d{8,10}$/.test(value), '전화번호를 확인하세요.'),
    business_name: name,
    biz_no: z
      .string()
      .trim()
      .regex(/^(\d{10}|\d{3}-\d{2}-\d{5})$/, '사업자번호는 000-00-00000 형식으로 입력하세요.')
      .transform((value) => value.replace(/\D/g, '').replace(/^(\d{3})(\d{2})(\d{5})$/, '$1-$2-$3')),
    plate_no: name.transform((value) => value.replace(/\s/g, '').toUpperCase()),
    vehicle_type: name.default('카고'),
    tonnage: z
      .string()
      .regex(/^\d{1,9}(\.\d{1,3})?$/)
      .pipe(
        z.string().refine((value) => new Decimal(value).gt(0), '차량 최대 적재 톤수는 0보다 커야 합니다.'),
      ),
  })
  .strict();
export type DriverInformation = z.output<typeof driverInformationSchema>;
export const driverProfilePatchSchema = driverInformationSchema.extend({
  version: z.number().int().positive(),
});
export const joinLinkSchema = z
  .object({
    project_ids: z
      .array(z.string().uuid())
      .min(1)
      .max(500)
      .transform((ids) => [...new Set(ids)]),
    expires_in_days: z.number().int().min(1).max(90).default(14),
  })
  .strict();
