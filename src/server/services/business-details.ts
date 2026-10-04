import { z } from 'zod';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => (value === '' ? null : value));
export const businessDetailsFields = {
  representative_name: optionalText(200),
  address: optionalText(500),
  business_type: optionalText(100),
  business_item: optionalText(100),
};
export const businessDetailKeys = [
  'representative_name',
  'address',
  'business_type',
  'business_item',
] as const;
export type BusinessDetails = { [K in (typeof businessDetailKeys)[number]]?: string | null };
export function businessDetails(input: BusinessDetails) {
  return Object.fromEntries(
    businessDetailKeys.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]),
  ) as BusinessDetails;
}
