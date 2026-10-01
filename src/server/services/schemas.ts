import { uploadLimit, uploadLimitMessage } from '../upload-limits';
import { passwordWithinByteLimit } from '../auth/password';
import { z } from 'zod';
import Decimal from 'decimal.js';
import {
  billingUnitEnum,
  directionEnum,
  evidenceKindEnum,
  operationStatusEnum,
  roleEnum,
} from '../db/schema';
export const uuid = z.string().uuid();
export const dateString = z.iso.date();
export const quantity = z.string().regex(/^\d{1,9}(\.\d{1,3})?$/, '수량은 소수 셋째 자리까지 입력하세요.');
export const amount = z.number().int().min(0).max(2147483647);
export const versionInput = z.object({ version: z.number().int().positive() });
const nullableText = z.string().max(5000).nullable().optional();
export const tripInput = z
  .object({
    id: uuid.optional(),
    seq: z.number().int().positive(),
    status: z.enum(operationStatusEnum.enumValues).default('COMPLETED'),
    origin: z.string().min(1).max(500),
    destination: z.string().min(1).max(500),
    via: z.array(z.string().max(500)).max(50).nullable().optional(),
    depart_at: z.iso.datetime({ offset: true }).nullable().optional(),
    arrive_at: z.iso.datetime({ offset: true }).nullable().optional(),
    cargo_desc: nullableText,
    quantity: quantity.nullable().optional(),
    quantity_unit: nullableText,
    hours: quantity.nullable().optional(),
    is_empty_return: z.boolean().default(false),
    notes: nullableText,
    client_row_id: z.string().min(1).max(200).nullable().optional(),
  })
  .strict();
export const chargeInput = z
  .object({
    id: uuid.optional(),
    trip_id: uuid.nullable().optional(),
    direction: z.enum(directionEnum.enumValues).default('PAYABLE'),
    charge_type: z.enum(['BASE', 'WAITING', 'TOLL', 'EXTRA_STOP', 'CANCEL_FEE', 'EXPENSE', 'OTHER']),
    billing_unit: z.enum(billingUnitEnum.enumValues).optional(),
    quantity: quantity.nullable().optional(),
    requested_amount: amount.nullable().optional(),
    reason: nullableText,
    included_in_base: z.boolean().default(false),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.charge_type !== 'BASE' && (v.requested_amount == null || !v.reason?.trim()))
      ctx.addIssue({ code: 'custom', message: '추가비는 요청액과 사유를 입력하세요.' });
  });
export const loadTonnage = z
  .string()
  .regex(/^\d{1,7}(\.\d{1,3})?$/, '적재용량은 소수 셋째 자리까지 입력하세요.')
  .refine(
    (value) => /^\d{1,7}(\.\d{1,3})?$/.test(value) && new Decimal(value).gt(0),
    '적재용량은 0보다 커야 합니다.',
  );
const fields = {
  reviewer_user_id: uuid.nullable().optional(),
  load_tonnage: loadTonnage.nullable().optional(),
  use_date: dateString,
  end_date: dateString.nullable().optional(),
  project_id: uuid,
  work_type_id: uuid.nullable().optional(),
  requester: nullableText,
  driver_id: uuid,
  vehicle_id: uuid,
  payee_counterparty_id: uuid.optional(),
  customer_counterparty_id: uuid.nullable().optional(),
  cargo_desc: nullableText,
  notes: nullableText,
  operation_status: z.enum(operationStatusEnum.enumValues).optional(),
  billing_unit: z.enum(billingUnitEnum.enumValues).optional(),
  quantity: quantity.nullable().optional(),
  trips: z.array(tripInput).max(500).optional(),
  charge_lines: z.array(chargeInput).max(100).optional(),
};
export const createUseSchema = z
  .object({ ...fields, client_request_id: z.string().min(1).max(200).optional() })
  .strict();
export const updateUseSchema = z
  .object(fields)
  .partial()
  .extend({ version: z.number().int().positive(), change_reason: z.string().max(1000).optional() })
  .strict();
export type CreateUseInput = z.input<typeof createUseSchema>;
export type UpdateUseInput = z.input<typeof updateUseSchema>;
export type ChargeInput = z.output<typeof chargeInput>;
export const lineDecision = z
  .object({
    id: uuid,
    line_review_status: z.enum(['APPROVED', 'HELD', 'REJECTED']),
    approved_amount: amount.optional(),
    reason: z.string().max(1000).optional(),
  })
  .strict();
export const approveSchema = versionInput
  .extend({
    lines: z.array(lineDecision).max(100).optional(),
    comment: z.string().max(5000).optional(),
    quick_approval: z
      .object({
        review_base_amount: z.number().int().safe(),
        review_extra_amount: z.number().int().safe(),
        review_total_amount: z.number().int().safe(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((input) => !input.quick_approval || input.lines === undefined, {
    message: '바로 승인은 비용별 검수와 함께 요청할 수 없습니다.',
  });
export const fixSchema = versionInput
  .extend({
    comment: z.string().max(5000).optional(),
    fix_items: z
      .array(z.object({ target: z.string().min(1).max(200), message: z.string().min(1).max(1000) }).strict())
      .min(1)
      .max(100),
  })
  .strict();
export const reasonSchema = versionInput.extend({ reason: z.string().trim().min(1).max(1000) }).strict();
export const copySchema = z
  .object({ use_date: dateString.optional(), client_request_id: z.string().min(1).max(200) })
  .strict();
export const evidenceSchema = z
  .object({
    client_upload_id: z.string().min(1).max(200),
    trip_id: uuid.nullable().optional(),
    kind: z.enum(evidenceKindEnum.enumValues),
    original_name: z.string().min(1).max(255).optional(),
    mime: z
      .enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
      .optional(),
    size: z
      .number()
      .int()
      .positive()
      .refine((size) => size <= uploadLimit(), { error: () => uploadLimitMessage() })
      .optional(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    text_value: z.string().trim().min(1).max(2000).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      !(v.text_value && ['SLIP_NO', 'CONFIRMATION'].includes(v.kind)) &&
      (!v.original_name || !v.mime || !v.size)
    )
      ctx.addIssue({ code: 'custom', message: '파일명·형식·크기 또는 대체증빙 내용을 입력하세요.' });
    if (v.kind === 'SLIP_NO' && !v.text_value)
      ctx.addIssue({ code: 'custom', message: '전표번호를 입력하세요.' });
  });
export const inviteSchema = z
  .object({
    role: z.enum(roleEnum.enumValues),
    name: z.string().trim().min(1).max(100),
    phone: z.string().max(100).optional(),
    driver_id: uuid.optional(),
    project_ids: z.array(uuid).max(100).default([]),
  })
  .strict();
export const loginSchema = z
  .object({
    login_id: z.string().min(1).max(200),
    password: z.string().min(1).refine(passwordWithinByteLimit, '비밀번호가 너무 깁니다'),
  })
  .strict();
export const acceptInviteSchema = z
  .object({
    login_id: z.string().trim().min(1).max(100),
    password: z.string().min(8).refine(passwordWithinByteLimit, '비밀번호가 너무 깁니다'),
  })
  .strict();
export const rateLookupSchema = z.object({
  project_id: uuid,
  counterparty_id: uuid,
  vehicle_id: uuid,
  use_date: dateString,
  direction: z.enum(directionEnum.enumValues).default('PAYABLE'),
  billing_unit: z.enum(billingUnitEnum.enumValues).optional(),
  completed_trips: z.coerce.number().int().min(0).max(500).default(0),
});
export const listUsesSchema = z.object({
  reviewer_user_id: uuid.optional(),
  transport_search: z.string().trim().max(100).optional(),
  exclude_canceled: z.enum(['true']).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  project_id: uuid.optional(),
  driver_id: uuid.optional(),
  from: dateString.optional(),
  to: dateString.optional(),
  review_status: z.enum(['DRAFT', 'SUBMITTED', 'NEEDS_FIX', 'APPROVED']).optional(),
  operation_status: z.enum(operationStatusEnum.enumValues).optional(),
  search: z.string().max(100).optional(),
  sort: z.enum(['use_date', 'created_at', 'use_no']).default('use_date'),
  order: z.enum(['asc', 'desc']).default('desc'),
});
