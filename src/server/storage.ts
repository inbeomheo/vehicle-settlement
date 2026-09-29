import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { Db } from './db/client';
import { evidenceBlobs } from './db/schema';

export function storageDriver() {
  const driver = process.env.STORAGE_DRIVER ?? 'local';
  if (driver !== 'local' && driver !== 'db') throw new Error('STORAGE_DRIVER는 local 또는 db여야 합니다.');
  return driver;
}
function storagePath(key: string, root = process.env.STORAGE_DIR ?? 'storage') {
  if (!/^(?:[a-f0-9-]{36}\/[a-f0-9-]{36}|imports\/[a-f0-9-]{36}\.xlsx)$/.test(key))
    throw new Error('파일 경로가 올바르지 않습니다.');
  return path.resolve(root, key);
}
export function verifyStoredBytes(bytes: Buffer, size: number, sha256: string) {
  if (bytes.length !== size || createHash('sha256').update(bytes).digest('hex') !== sha256)
    throw new Error('저장 파일 해시/크기 불일치');
  return bytes;
}
export async function writeStoredFile(db: Db, key: string, bytes: Buffer) {
  const dest = storagePath(key);
  if (storageDriver() === 'db') {
    await db.insert(evidenceBlobs).values({
      storage_key: key,
      bytes,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  } else {
    await mkdir(path.dirname(dest), { recursive: true, mode: 0o700 });
    await writeFile(dest, bytes, { flag: 'wx', mode: 0o600 });
  }
}
export async function readStoredFile(db: Db, key: string, root?: string) {
  const dest = storagePath(key, root);
  if (storageDriver() === 'local') return readFile(dest);
  const [row] = await db.select().from(evidenceBlobs).where(eq(evidenceBlobs.storage_key, key));
  if (!row) throw new Error('저장 파일이 없습니다.');
  return verifyStoredBytes(row.bytes, row.size, row.sha256);
}
export async function deleteStoredFile(db: Db, key: string) {
  const dest = storagePath(key);
  if (storageDriver() === 'db') await db.delete(evidenceBlobs).where(eq(evidenceBlobs.storage_key, key));
  else
    await unlink(dest).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
}
