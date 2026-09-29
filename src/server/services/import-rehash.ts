import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client';
import { auditLogs, importJobs, vehicleUses } from '../db/schema';
import { AppError, invalid } from '../errors';
import { previewSchema, type ImportMapping, type ImportRow } from './import-fields';
import {
  importIdentityLock,
  importSourceHash,
  parseImportSource,
  type ImportSourceIds,
} from './import-source';

const sourceIdsSchema = z.object({
  project_id: z.string().uuid(),
  driver_id: z.string().uuid(),
  vehicle_id: z.string().uuid(),
  payee_counterparty_id: z.string().uuid(),
});
const rowSchema = z.object({
  row: z.number().int().positive(),
  values: z.array(z.string()),
  status: z.enum(['VALID', 'ERROR', 'SKIPPED']),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
  source_row_hash: z.string(),
  source_ids: sourceIdsSchema.optional(),
  use_id: z.string().uuid().optional(),
});
const referenceFields = {
  project: 'project_id',
  driver: 'driver_id',
  vehicle: 'vehicle_id',
  payee: 'payee_counterparty_id',
} as const;
const normalizeReference = (value: string) => value.toLowerCase().replace(/[\s_()·/.-]/g, '');
type ReferenceMap = Map<string, Set<string>>;
export type ImportRehashLog = { job_id: string; row?: number; use_id?: string; message: string };

function referenceKey(row: ImportRow, mapping: ImportMapping, field: keyof typeof referenceFields) {
  const column = mapping[field];
  return `${field}:${normalizeReference(column === undefined ? '' : (row.values[column] ?? ''))}`;
}

function rememberReferences(
  row: ImportRow,
  mapping: ImportMapping,
  ids: ImportSourceIds,
  refs: ReferenceMap,
) {
  for (const [field, idField] of Object.entries(referenceFields)) {
    const key = referenceKey(row, mapping, field as keyof typeof referenceFields);
    const matches = refs.get(key) ?? new Set<string>();
    matches.add(ids[idField]);
    refs.set(key, matches);
  }
}

function excludedSourceIds(row: ImportRow, mapping: ImportMapping, refs: ReferenceMap) {
  const ids: Partial<ImportSourceIds> = {};
  for (const [field, idField] of Object.entries(referenceFields)) {
    const matches = refs.get(referenceKey(row, mapping, field as keyof typeof referenceFields));
    if (matches?.size === 1) ids[idField] = [...matches][0];
  }
  return sourceIdsSchema.parse(ids);
}

// Maintenance only: never called by upload, preview, or commit.
export async function recalculateImportHashes(
  db: Database,
  log: (entry: ImportRehashLog) => void = () => {},
) {
  const summary = { updated: 0, unchanged: 0, skipped: 0 };
  const jobs = await db
    .select({ id: importJobs.id })
    .from(importJobs)
    .where(eq(importJobs.status, 'COMMITTED'))
    .orderBy(asc(importJobs.created_at), asc(importJobs.id));
  for (const { id } of jobs) {
    const counts = { updated: 0, unchanged: 0, skipped: 0 };
    try {
      await db.transaction(async (tx) => {
        // Same order as commitImport: job lock, then the common import lock.
        const [job] = await tx.select().from(importJobs).where(eq(importJobs.id, id)).for('update');
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${importIdentityLock}, 0))`);
        const selection = previewSchema.parse(job.mapping);
        const payload = z
          .object({ preview: z.array(z.unknown()) })
          .passthrough()
          .parse(job.rows);
        const uses = await tx
          .select()
          .from(vehicleUses)
          .where(eq(vehicleUses.import_job_id, id))
          .for('update');
        const useById = new Map(uses.map((use) => [use.id, use]));
        const created = uses.length
          ? await tx
              .select({ id: auditLogs.entity_id, after: auditLogs.after })
              .from(auditLogs)
              .where(
                and(
                  eq(auditLogs.entity_type, 'vehicle_use'),
                  eq(auditLogs.action, 'CREATE'),
                  inArray(
                    auditLogs.entity_id,
                    uses.map((use) => use.id),
                  ),
                ),
              )
          : [];
        const createdById = new Map(created.map((entry) => [entry.id, entry.after]));
        const refs: ReferenceMap = new Map();
        const idsByRow = new Map<number, ImportSourceIds>();
        const rows: ImportRow[] = [];
        for (const value of payload.preview) {
          const parsed = rowSchema.safeParse(value);
          if (!parsed.success) {
            counts.skipped++;
            log({ job_id: id, message: '원본 행 형식을 확인할 수 없어 건너뜀' });
            continue;
          }
          const row = parsed.data;
          rows.push(row);
          const ids = sourceIdsSchema.safeParse(row.source_ids ?? createdById.get(row.use_id ?? ''));
          if (ids.success) {
            idsByRow.set(row.row, ids.data);
            rememberReferences(row, selection.mapping, ids.data, refs);
          }
        }
        const occurrences = new Map<string, number>();
        const handled = new Set<string>();
        for (const row of rows.sort((a, b) => a.row - b.row)) {
          const use = row.use_id ? useById.get(row.use_id) : undefined;
          if (use) handled.add(use.id);
          try {
            if (row.status === 'ERROR' || row.errors.length) invalid('이전 검증 실패 행');
            if (row.use_id && !use) invalid('가져오기 작업과 사용 건 연결 불일치');
            const ids = idsByRow.get(row.row) ?? excludedSourceIds(row, selection.mapping, refs);
            const source = parseImportSource(row.values, selection.mapping, ids);
            const hash = importSourceHash(source, occurrences);
            if (use) {
              if (use.source_row_hash === hash) counts.unchanged++;
              else {
                // A duplicate or bad row must not abort the other rows in this job.
                await tx.transaction(async (savepoint) => {
                  await savepoint
                    .update(vehicleUses)
                    .set({ source_row_hash: hash })
                    .where(eq(vehicleUses.id, use.id));
                });
                counts.updated++;
              }
            }
            row.source_row_hash = hash;
            row.source_ids = source.sourceIds;
          } catch (error) {
            row.source_row_hash = '';
            delete row.source_ids;
            if (use)
              await tx.update(vehicleUses).set({ source_row_hash: null }).where(eq(vehicleUses.id, use.id));
            counts.skipped++;
            log({
              job_id: id,
              row: row.row,
              use_id: use?.id,
              message:
                error instanceof AppError
                  ? error.message
                  : '원본 값·당시 UUID 근거 또는 중복 해시를 확인할 수 없어 건너뜀',
            });
          }
        }
        for (const use of uses.filter((use) => !handled.has(use.id))) {
          await tx.update(vehicleUses).set({ source_row_hash: null }).where(eq(vehicleUses.id, use.id));
          counts.skipped++;
          log({ job_id: id, use_id: use.id, message: '연결된 원본 행이 없어 해시 재계산 건너뜀' });
        }
        // Preserve raw sheets, amounts, approvals, snapshots, versions, and audit history.
        const byRow = new Map(rows.map((row) => [row.row, row]));
        payload.preview = payload.preview.map((value) => {
          const parsed = rowSchema.safeParse(value);
          return parsed.success ? byRow.get(parsed.data.row) : value;
        });
        delete payload.file_hash;
        await tx.update(importJobs).set({ rows: payload }).where(eq(importJobs.id, id));
      });
      summary.updated += counts.updated;
      summary.unchanged += counts.unchanged;
      summary.skipped += counts.skipped;
    } catch {
      summary.skipped++;
      log({ job_id: id, message: '작업의 매핑·원본 구조 또는 DB 처리 오류로 건너뜀 (해당 작업 변경 롤백)' });
    }
  }
  return summary;
}
