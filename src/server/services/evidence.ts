import { assertDriverEvidenceAccess } from '../authz';
import { readBoundedBody } from '../request-body';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { evidence, trips, useRevisions } from '../db/schema';
import type { Context } from '../context';
import { audit } from '../audit';
import { AppError, invalid, notFound } from '../errors';
import { assertUnlocked, atomic, contentChanged, rawUse, rawDetail } from './uses';
import { evidenceSchema } from './schemas';
export const MAX_UPLOAD_SIZE = 20 * 1024 * 1024;
const root = () => path.resolve(process.env.STORAGE_DIR ?? 'storage');
function storagePath(key: string) {
  if (!/^[a-f0-9-]{36}\/[a-f0-9-]{36}$/.test(key)) invalid('파일 경로가 올바르지 않습니다.');
  return path.join(root(), key);
}
function publicEvidence(row: typeof evidence.$inferSelect) {
  const { storage_key: _key, ...out } = row;
  void _key;
  return out;
}
export async function createEvidence(ctx: Context, useId: string, raw: z.input<typeof evidenceSchema>) {
  const input = evidenceSchema.parse(raw);
  return atomic(ctx, async (tx) => {
    const use = await rawUse(tx, useId, true);
    if (use.operation_status === 'CANCELED') invalid('취소된 사용 건입니다.');
    await tx.db.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`upload:${input.client_upload_id}`}, 0))`,
    );
    const [old] = await tx.db
      .select()
      .from(evidence)
      .where(eq(evidence.client_upload_id, input.client_upload_id));
    if (old) {
      await assertDriverEvidenceAccess(tx, old.id);
      if (old.vehicle_use_id !== useId || old.deleted_at || old.replaced_by_id) notFound();
      if (
        old.kind !== input.kind ||
        old.original_name !== (input.original_name ?? null) ||
        old.text_value !== (input.text_value ?? null) ||
        old.trip_id !== (input.trip_id ?? null) ||
        old.mime !== (input.mime ?? null) ||
        old.size !== (input.size ?? null) ||
        (input.sha256 !== undefined && old.sha256 !== input.sha256)
      )
        throw new AppError('IDEMPOTENCY_MISMATCH', '같은 업로드 식별자에 다른 증빙을 보낼 수 없습니다.');
      return publicEvidence(old);
    }
    await assertUnlocked(tx, useId);
    if (input.trip_id) {
      const [trip] = await tx.db.select().from(trips).where(eq(trips.id, input.trip_id));
      if (!trip || trip.vehicle_use_id !== useId) notFound();
    }
    const isText = Boolean(input.text_value && ['SLIP_NO', 'CONFIRMATION'].includes(input.kind));
    const [row] = await tx.db
      .insert(evidence)
      .values({
        ...input,
        vehicle_use_id: useId,
        uploaded_by: tx.user.id,
        upload_status: isText ? 'UPLOADED' : 'PENDING',
        uploaded_at: isText ? new Date() : null,
      })
      .returning();
    await contentChanged(tx, use);
    await audit(tx, 'CREATE_EVIDENCE', 'evidence', row.id, null, publicEvidence(row));
    return publicEvidence(row);
  });
}
async function accessibleEvidence(ctx: Context, id: string, lock = false, history = false) {
  const [file] = await ctx.db.select().from(evidence).where(eq(evidence.id, id));
  if (!file || file.deleted_at || (!history && file.replaced_by_id)) notFound();
  const use = await rawUse(ctx, file.vehicle_use_id, lock);
  // Re-read after acquiring the parent lock, so replacement/deletion cannot race upload.
  const [current] = await ctx.db.select().from(evidence).where(eq(evidence.id, id));
  if (current.deleted_at || (!history && current.replaced_by_id)) notFound();
  await assertDriverEvidenceAccess(ctx, id);
  return { file: current, use };
}
function validMagic(bytes: Buffer, mime: string) {
  if (mime === 'application/pdf') return bytes.subarray(0, 5).toString() === '%PDF-';
  if (mime === 'image/jpeg') return bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (mime === 'image/png')
    return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/webp')
    return bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (['image/heic', 'image/heif'].includes(mime))
    return (
      bytes.subarray(4, 8).toString() === 'ftyp' &&
      /^(heic|heix|hevc|hevx|mif1|msf1)$/.test(bytes.subarray(8, 12).toString())
    );
  return false;
}
export async function readUpload(request: Request) {
  if (!request.body) invalid('파일 내용이 없습니다.');
  return readBoundedBody(request, MAX_UPLOAD_SIZE, '파일은 20MB 이하만 업로드할 수 있습니다.');
}
export async function markUploadFailed(ctx: Context, id: string, reason: string) {
  return atomic(ctx, async (tx) => {
    const { file, use } = await accessibleEvidence(tx, id, true);
    await assertUnlocked(tx, use.id);
    if (file.upload_status === 'UPLOADED') return;
    const [after] = await tx.db
      .update(evidence)
      .set({ upload_status: 'FAILED', updated_at: new Date() })
      .where(eq(evidence.id, id))
      .returning();
    await audit(tx, 'UPLOAD_FAILED', 'evidence', id, publicEvidence(file), publicEvidence(after), reason);
  });
}
export async function uploadEvidence(ctx: Context, id: string, bytes: Buffer, mime: string) {
  let written: string | undefined;
  try {
    const result = await atomic(ctx, async (tx) => {
      const { file, use } = await accessibleEvidence(tx, id, true);
      await assertUnlocked(tx, use.id);
      if (use.operation_status === 'CANCELED') invalid('취소된 사용 건입니다.');
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (file.upload_status === 'UPLOADED') {
        if (file.sha256 === hash && file.mime === mime) return { row: publicEvidence(file) };
        invalid('업로드한 파일 변경은 증빙 교체를 이용하세요.');
      }
      const failure =
        bytes.length === 0 || bytes.length > MAX_UPLOAD_SIZE
          ? '파일은 1바이트 이상 20MB 이하여야 합니다.'
          : mime !== file.mime || bytes.length !== file.size || !validMagic(bytes, mime)
            ? '파일 형식 또는 크기가 메타정보와 다릅니다.'
            : file.sha256 && file.sha256 !== hash
              ? '파일 해시가 일치하지 않습니다.'
              : null;
      if (failure) {
        const [after] = await tx.db
          .update(evidence)
          .set({ upload_status: 'FAILED', updated_at: new Date() })
          .where(eq(evidence.id, id))
          .returning();
        await audit(
          tx,
          'UPLOAD_FAILED',
          'evidence',
          id,
          publicEvidence(file),
          publicEvidence(after),
          failure,
        );
        return { failure };
      }
      const key = `${use.id}/${randomUUID()}`;
      const dest = storagePath(key);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, bytes, { flag: 'wx', mode: 0o600 });
      written = dest;
      const [after] = await tx.db
        .update(evidence)
        .set({
          storage_key: key,
          sha256: hash,
          size: bytes.length,
          upload_status: 'UPLOADED',
          uploaded_by: tx.user.id,
          uploaded_at: new Date(),
          updated_at: new Date(),
        })
        .where(eq(evidence.id, id))
        .returning();
      await contentChanged(tx, use);
      await audit(tx, 'UPLOAD', 'evidence', id, publicEvidence(file), publicEvidence(after));
      return { row: publicEvidence(after) };
    });
    if (result.failure) invalid(result.failure);
    return result.row!;
  } catch (error) {
    if (written) await unlink(written).catch(() => {});
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      ['ENOSPC', 'EACCES', 'ENOENT', 'EIO'].includes(String(error.code))
    )
      await markUploadFailed(ctx, id, '파일 저장 실패');
    throw error;
  }
}
export async function downloadEvidence(ctx: Context, id: string) {
  const { file } = await accessibleEvidence(ctx, id, false, true);
  if (file.upload_status !== 'UPLOADED' || !file.storage_key) notFound();
  const bytes = await readFile(storagePath(file.storage_key)).catch(() => notFound());
  return { file: publicEvidence(file), bytes };
}
export async function deleteEvidence(ctx: Context, id: string, reason: string) {
  z.string().trim().min(1).max(1000).parse(reason);
  return atomic(ctx, async (tx) => {
    const { file, use } = await accessibleEvidence(tx, id, true);
    await assertUnlocked(tx, use.id);
    const [after] = await tx.db
      .update(evidence)
      .set({ deleted_at: new Date(), updated_at: new Date() })
      .where(eq(evidence.id, id))
      .returning();
    await contentChanged(tx, use);
    await audit(tx, 'DELETE_EVIDENCE', 'evidence', id, publicEvidence(file), publicEvidence(after), reason);
    return publicEvidence(after);
  });
}
export async function replaceEvidence(
  ctx: Context,
  id: string,
  raw: z.input<typeof evidenceSchema>,
  reason: string,
) {
  z.string().trim().min(1).max(1000).parse(reason);
  return atomic(ctx, async (tx) => {
    const { file, use } = await accessibleEvidence(tx, id, true);
    await assertUnlocked(tx, use.id);
    const input = evidenceSchema.parse(raw);
    const [existing] = await tx.db
      .select()
      .from(evidence)
      .where(eq(evidence.client_upload_id, input.client_upload_id));
    if (existing) invalid('교체할 증빙은 새 업로드 식별자를 사용하세요.');
    const replacement = await createEvidence(tx, use.id, input);
    const [after] = await tx.db
      .update(evidence)
      .set({ replaced_by_id: replacement.id, replace_reason: reason, updated_at: new Date() })
      .where(eq(evidence.id, id))
      .returning();
    const current = await rawUse(tx, use.id);
    if (current.review_status === 'SUBMITTED') {
      const { revisions: _revisions, ...snapshot } = await rawDetail(tx, current);
      void _revisions;
      await tx.db
        .update(useRevisions)
        .set({ snapshot, updated_at: new Date() })
        .where(
          and(
            eq(useRevisions.vehicle_use_id, use.id),
            eq(useRevisions.revision_no, current.current_revision_no),
            eq(useRevisions.decision, 'PENDING'),
          ),
        );
    }
    await audit(tx, 'REPLACE_EVIDENCE', 'evidence', id, publicEvidence(file), publicEvidence(after), reason);
    return replacement;
  });
}
