import { z } from 'zod';
import type { ImportSourceIds } from './import-source';

export const importFields = {
  reviewer: ['담당자', '검수담당자'],
  load_tonnage: ['적재용량', '적재용량(톤)'],
  use_date: ['사용일', '운행일', '일자', '날짜'],
  project: ['현장', '현장명', '현장코드'],
  driver: ['기사', '기사명', '운전자'],
  vehicle: ['차량번호', '차량', '차번'],
  payee: ['운송사/지급처', '운송사', '지급처', '업체명'],
  origin: ['출발지', '상차지', '상차장'],
  destination: ['도착지', '하차지', '하차장'],
  cargo_desc: ['운반내용', '화물', '품명'],
  trips: ['운행횟수', '운행수', '횟수'],
  billing_unit: ['과금단위', '과금방식', '단위'],
  quantity: ['청구수량', '청구량', '수량'],
  unit_price: ['단가', '계약단가', '운임단가'],
  extra: ['추가비', '추가금액'],
  reason: ['추가비사유', '추가비·사유', '사유'],
  notes: ['비고', '메모'],
} as const;
export type ImportField = keyof typeof importFields;
export type ImportMapping = Partial<Record<ImportField, number>>;
export const mappingSchema = z.partialRecord(
  z.enum(Object.keys(importFields) as [ImportField, ...ImportField[]]),
  z.number().int().min(0).max(99),
);
export const previewSchema = z
  .object({
    sheet: z.number().int().min(0),
    header_row: z.number().int().min(1),
    mapping: mappingSchema,
    // Existing API callers retain their previous handling of blank prices.
    apply_contract_rate: z.boolean().default(false),
    excluded_rows: z.array(z.number().int().min(1).max(2000)).max(2000).default([]),
  })
  .strict();
export const presetSchema = z
  .object({ name: z.string().trim().min(1).max(100), mapping: mappingSchema })
  .strict();
export type SheetData = {
  name: string;
  rows: string[][];
  header_row: number;
  mapping: ImportMapping;
  cell_errors?: Record<number, Record<number, string>>;
};
export type ImportRow = {
  row: number;
  values: string[];
  status: 'VALID' | 'ERROR' | 'SKIPPED';
  errors: string[];
  warnings: string[];
  source_row_hash: string;
  source_ids?: ImportSourceIds;
  use_id?: string;
};
export type ImportSummary = { valid: number; errors: number; skipped: number; success: number };
export type ImportView = {
  id: string;
  file_name: string;
  status: string;
  created_at: string;
  created_by_name?: string;
  sheets: SheetData[];
  selection: z.infer<typeof previewSchema> | null;
  preview: ImportRow[];
  summary: ImportSummary | null;
};
