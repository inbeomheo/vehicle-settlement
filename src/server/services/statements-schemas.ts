import { z } from 'zod';
import { dateString, uuid, versionInput } from './schemas';
export const directionSchema = z.enum(['PAYABLE', 'RECEIVABLE']);
const reason = z.string().trim().min(1, '사유를 입력하세요.').max(1000);
export const statementItemSchema = z
  .object({
    charge_line_id: uuid,
    inclusion: z.enum(['INCLUDED', 'HELD']).default('INCLUDED'),
    hold_reason: reason.nullable().optional(),
  })
  .strict()
  .refine((v) => v.inclusion !== 'HELD' || !!v.hold_reason, '보류 사유를 입력하세요.');
const items = z
  .array(statementItemSchema)
  .min(1)
  .max(1000)
  .refine(
    (rows) => new Set(rows.map((r) => r.charge_line_id)).size === rows.length,
    '같은 비용을 중복으로 선택할 수 없습니다.',
  );
export const createStatementSchema = z
  .object({
    client_request_id: z.string().trim().min(1).max(200),
    direction: directionSchema,
    counterparty_id: uuid,
    period_start: dateString,
    period_end: dateString,
    title: z.string().trim().max(200).optional(),
    due_date: dateString.nullable().optional(),
    replaces_statement_id: uuid.optional(),
    items,
  })
  .strict()
  .refine((v) => v.period_start <= v.period_end, '정산 기간을 확인하세요.');
export const updateStatementSchema = versionInput
  .extend({
    items: items.optional(),
    due_date: dateString.nullable().optional(),
  })
  .strict();
export const confirmStatementSchema = versionInput
  .extend({ confirmation_token: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
export const cancelStatementSchema = versionInput.extend({ reason }).strict();
export const candidateSchema = z
  .object({
    direction: directionSchema,
    counterpartyId: uuid,
    periodStart: dateString,
    periodEnd: dateString,
    statementId: uuid.optional(),
  })
  .refine((v) => v.periodStart <= v.periodEnd, '정산 기간을 확인하세요.');
export const statementListSchema = z.object({
  direction: directionSchema.optional(),
  counterpartyId: uuid.optional(),
  status: z.enum(['DRAFT', 'CONFIRMED', 'CANCELED']).optional(),
  periodStart: dateString.optional(),
  periodEnd: dateString.optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['created_at', 'period_start', 'due_date', 'grand_total']).default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export const paymentSchema = z
  .object({
    client_request_id: z.string().trim().min(1).max(200),
    kind: z.enum(['PAYMENT', 'RECEIPT']),
    amount: z.number().int().min(-2147483647).max(2147483647),
    paid_on: dateString,
    method: z.string().trim().min(1).max(100),
    reference: z.string().max(200).optional(),
    memo: z.string().max(2000).optional(),
  })
  .strict();
export const voidPaymentSchema = z.object({ reason }).strict();
export const paymentOverviewSchema = statementListSchema.extend({
  state: z.enum(['ALL', 'UNPAID', 'OVERDUE', 'PAID']).default('UNPAID'),
});
export const adjustmentSchema = z
  .object({
    adjusts_statement_id: uuid,
    charge_line_id: uuid,
    supply_amount: z.number().int().min(-2147483647).max(2147483647),
    reason,
    effective_date: dateString.optional(),
  })
  .strict();
export const driverSettlementSchema = z
  .object({
    periodStart: dateString,
    periodEnd: dateString,
  })
  .refine((v) => v.periodStart <= v.periodEnd, '조회 기간을 확인하세요.');
