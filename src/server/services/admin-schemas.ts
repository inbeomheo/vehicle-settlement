import { z } from 'zod';
import { amount, dateString, quantity, uuid } from './schemas';
import { billingUnitEnum, directionEnum, taxModeEnum, roundingEnum, roleEnum } from '../db/schema';
const name = z.string().trim().min(1).max(200);
const text = z.string().trim().max(2000).nullable().optional();
const active = z.boolean().default(true);
const dates = { valid_from: dateString, valid_to: dateString.nullable().default(null) };
export const masterSchemas = {
  projects: z
    .object({
      code: z.string().trim().max(200).nullable().optional(),
      name,
      active,
      evidence_policy: z.enum(['PHOTO_REQUIRED', 'PHOTO_OR_ALTERNATIVE', 'NONE']),
    })
    .strict(),
  'work-types': z.object({ name, active }).strict(),
  counterparties: z
    .object({
      name,
      kind: z.enum(['CARRIER', 'DRIVER_BUSINESS', 'CUSTOMER']),
      biz_no: text,
      contact_name: text,
      phone: text,
      bank_account: text,
      active,
    })
    .strict(),
  drivers: z
    .object({ name, phone: text, default_vehicle_id: uuid.nullable().default(null), active })
    .strict(),
  vehicles: z.object({ plate_no: name, vehicle_type: name, tonnage: quantity, active }).strict(),
  affiliations: z.object({ driver_id: uuid, counterparty_id: uuid, ...dates }).strict(),
  company: z
    .object({
      name,
      biz_no: text,
      address: text,
      representative: text,
      settlement_contact: text,
      default_tax_mode: z.enum(taxModeEnum.enumValues),
    })
    .strict(),
};
export type MasterResource = keyof typeof masterSchemas;
export const rateSchema = z
  .object({
    name,
    direction: z.enum(directionEnum.enumValues),
    counterparty_id: uuid,
    project_id: uuid.nullable().default(null),
    vehicle_type: name.nullable().default(null),
    tonnage: quantity.nullable().default(null),
    billing_unit: z.enum(billingUnitEnum.enumValues),
    unit_price: amount,
    ...dates,
    tax_mode: z.enum(taxModeEnum.enumValues).default('VAT_EXCLUDED'),
    rounding: z.enum(roundingEnum.enumValues).default('HALF_UP'),
    min_charge: amount.nullable().default(null),
    notes: text,
    active,
  })
  .strict();
export const userPatchSchema = z
  .object({
    version: z.number().int().positive(),
    name: name.optional(),
    phone: text,
    role: z.enum(roleEnum.enumValues).optional(),
    driver_id: uuid.nullable().optional(),
    all_projects: z.boolean().optional(),
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  })
  .strict();
export const assignmentSchema = z.object({ user_id: uuid, project_id: uuid, ...dates }).strict();
export function validateDates(input: { valid_from: string; valid_to?: string | null }) {
  if (input.valid_to && input.valid_to < input.valid_from)
    throw new z.ZodError([
      { code: 'custom', path: ['valid_to'], message: '종료일은 시작일 이후여야 합니다.' },
    ]);
}
