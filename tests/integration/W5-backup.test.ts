import { expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { testDatabase } from '../helpers/database';
import { defaultDatabaseUrl } from '../../src/server/db/client';
import { evidence } from '../../src/server/db/schema';
import { scenario, approved, confirmed } from './W4-fixtures';
import { backup } from '../../scripts/backup';
import { restore } from '../../scripts/restore';
import { digest, verifyDatabase, verifyManifest } from '../../scripts/backup-common';
const database = testDatabase();
it('백업 → DB 초기화 → 복구 → 증빙 SHA-256·확정 합계·시퀀스 검증 통과, 손상·덮어쓰기·실패 차단', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'w5-backup-'));
  const storage = path.join(temp, 'storage');
  const dir = path.join(temp, 'backup');
  const url = new URL(process.env.TEST_DATABASE_URL ?? defaultDatabaseUrl());
  url.pathname = `/${database().name}`;
  const client = await database().pool.connect();
  try {
    const s = await scenario(database().db);
    const use = await approved(s);
    const statement = await confirmed(
      s,
      use.charge_lines.map((l) => l.id),
    );
    const key = `${use.id}/${crypto.randomUUID()}`;
    const bytes = Buffer.from('증빙 복원 원본 bytes');
    await mkdir(path.join(storage, use.id), { recursive: true });
    await writeFile(path.join(storage, key), bytes);
    const [file] = await database()
      .db.insert(evidence)
      .values({
        vehicle_use_id: use.id,
        client_upload_id: crypto.randomUUID(),
        kind: 'PHOTO',
        storage_key: key,
        sha256: digest(bytes),
        size: bytes.length,
        upload_status: 'UPLOADED',
        uploaded_by: s.admin.id,
      })
      .returning();
    const before = (await client.query('SELECT last_value::text FROM use_no_seq')).rows;
    const manifest = await backup({ directory: dir, url: url.toString(), storage, logical: true });
    expect(manifest.format).toBe('app-logical-v1');
    expect(manifest.file_count).toBe(2);
    await expect(restore({ directory: dir, url: url.toString(), storage })).rejects.toThrow('storage');
    await client.query('DROP SCHEMA public CASCADE; DROP SCHEMA drizzle CASCADE; CREATE SCHEMA public');
    await rm(storage, { recursive: true });
    const result = await restore({ directory: dir, url: url.toString(), storage });
    expect(result).toEqual({ evidence_files: 1, confirmed_statements: 1 });
    expect(await readFile(path.join(storage, key))).toEqual(bytes);
    expect((await client.query('SELECT last_value::text FROM use_no_seq')).rows).toEqual(before);
    expect(
      (await client.query('SELECT grand_total FROM statements WHERE id=$1', [statement.id])).rows[0]
        .grand_total,
    ).toBe(300000);
    expect((await database().db.select().from(evidence).where(eq(evidence.id, file.id)))[0].sha256).toBe(
      digest(bytes),
    );
    await client.query('UPDATE statements SET grand_total=1 WHERE id=$1', [statement.id]);
    await expect(verifyDatabase(client, storage)).rejects.toThrow('확정명세');
    await client.query('UPDATE statements SET grand_total=300000 WHERE id=$1', [statement.id]);
    await writeFile(path.join(storage, key), '손상');
    await expect(
      backup({ directory: path.join(temp, 'failed'), url: url.toString(), storage, logical: true }),
    ).rejects.toThrow('증빙');
    expect(await readFile(path.join(temp, 'failed.partial', 'FAILED.txt'), 'utf8')).toContain('백업 실패');
    await writeFile(path.join(dir, 'storage', key), '손상');
    await expect(verifyManifest(dir)).rejects.toThrow('해시');
    await expect(
      restore({ directory: dir, url: url.toString(), storage: path.join(temp, 'fresh') }),
    ).rejects.toThrow('해시');
    console.log(
      'W5 리허설 통과: 빈 DB 복구 / 증빙 파일 1 / 확정명세 1 / 총액 300000 / 시퀀스 보존 / 손상 백업 차단',
    );
  } finally {
    client.release();
    await rm(temp, { recursive: true, force: true });
  }
}, 60000);
