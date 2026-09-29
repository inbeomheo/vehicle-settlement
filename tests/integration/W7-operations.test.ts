import { expect, it, vi } from 'vitest';
import { readFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { testDatabase } from '../helpers/database';
import { defaultDatabaseUrl } from '../../src/server/db/client';
import * as common from '../../scripts/backup-common';
import { restore } from '../../scripts/restore';
import { backup } from '../../scripts/backup';
import { setupScenario } from '../helpers/factories';
const database = testDatabase();
it('10. journal 시각은 과거·생성순이며 기존 미래 기록 보정 후 다음 마이그레이션도 실행', async () => {
  const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8'));
  const last = journal.entries.at(-1);
  expect(last.when).toBeGreaterThan(journal.entries.at(-2).when);
  expect(last.when).toBeLessThan(1790657972000); // Audit start, not a clock-dependent future pass.
  const client = await database().pool.connect();
  const temp = await mkdtemp(path.join(os.tmpdir(), 'w7-migration-'));
  try {
    const hash = common.digest(await readFile('drizzle/0100_w6_redact_invites.sql'));
    await client.query('UPDATE drizzle.__drizzle_migrations SET created_at=1790660000000 WHERE hash=$1', [
      hash,
    ]);
    // Import the production runner after the red assertion so the original failure is the future journal.
    const { migrateDatabase } = await import('../../src/server/db/migrate');
    await migrateDatabase(database().db);
    await migrateDatabase(database().db);
    expect(
      (await client.query('SELECT created_at FROM drizzle.__drizzle_migrations WHERE hash=$1', [hash])).rows,
    ).toEqual([{ created_at: String(last.when) }]);
    await mkdir(path.join(temp, 'meta'));
    await writeFile(
      path.join(temp, 'meta/_journal.json'),
      JSON.stringify({ entries: [{ idx: 0, tag: 'next', when: last.when + 1, breakpoints: true }] }),
    );
    await writeFile(path.join(temp, 'next.sql'), 'CREATE TABLE w7_migration_probe (id int)');
    await migrate(database().db, { migrationsFolder: temp });
    expect((await client.query("SELECT to_regclass('public.w7_migration_probe') AS name")).rows[0].name).toBe(
      'w7_migration_probe',
    );
  } finally {
    await client.query(
      'DROP TABLE IF EXISTS w7_migration_probe; DELETE FROM drizzle.__drizzle_migrations WHERE created_at=1790655000001',
    );
    client.release();
    await rm(temp, { recursive: true, force: true });
  }
});
it('9. pg_restore 성공 뒤 파일/DB 검증 실패는 빈 DB로 보상 복구한다', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'w7-restore-'));
  const url = new URL(process.env.TEST_DATABASE_URL ?? defaultDatabaseUrl());
  url.pathname = `/${database().name}`;
  const source = path.join(temp, 'source');
  const dir = path.join(temp, 'backup');
  await mkdir(source);
  const client = await database().pool.connect();
  try {
    await setupScenario(database().db);
    await backup({ directory: dir, storage: source, url: url.toString(), logical: true });
    // Native execution seam: simulate a successful committed pg_restore against real PG,
    // followed by evidence validation failure. No installed pg_restore is needed.
    const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
    manifest.format = 'pg-custom';
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    await client.query('DROP SCHEMA public CASCADE; DROP SCHEMA drizzle CASCADE; CREATE SCHEMA public');
    vi.spyOn(common, 'postgresBinary').mockResolvedValue('/test/pg_restore');
    vi.spyOn(common, 'runPostgres').mockImplementation(async () => {
      await client.query('CREATE TABLE restored_w7 (id int); INSERT INTO restored_w7 VALUES (1)');
    });
    vi.spyOn(common, 'verifyDatabase').mockRejectedValue(new Error('증빙 파일 해시/크기 불일치'));
    await expect(
      restore({ directory: dir, storage: path.join(temp, 'target'), url: url.toString() }),
    ).rejects.toThrow('증빙');
    expect((await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows).toEqual(
      [],
    );
  } finally {
    vi.restoreAllMocks();
    client.release();
    await rm(temp, { recursive: true, force: true });
  }
});
it('11. 개발 DB 오염 검사는 사용·명세·지급·증빙·감사·가져오기 모두 포함', async () => {
  const { createTestDatabase } = await import('../helpers/database');
  const isolated = await createTestDatabase();
  const { developmentCounts } = await import('../e2e/global-setup');
  const url = new URL(process.env.TEST_DATABASE_URL ?? defaultDatabaseUrl());
  url.pathname = `/${isolated.name}`;
  try {
    const s = await setupScenario(isolated.db);
    const { approved, confirmed } = await import('./W4-fixtures');
    const { recordPayment } = await import('../../src/server/services/payments');
    const { createEvidence } = await import('../../src/server/services/evidence');
    const { uploadImport } = await import('../../src/server/services/import');
    const before = await developmentCounts(url.toString());
    const use = await approved(s);
    const statement = await confirmed(
      s,
      use.charge_lines.map((line) => line.id),
    );
    await recordPayment(s.adminCtx, statement.id, {
      kind: 'PAYMENT',
      client_request_id: crypto.randomUUID(),
      amount: statement.grand_total,
      paid_on: '2026-09-29',
      method: '이체',
    });
    const { createUse } = await import('../../src/server/services/uses');
    const editable = await createUse(s.adminCtx, s.input);
    await createEvidence(s.adminCtx, editable.id, {
      client_upload_id: crypto.randomUUID(),
      kind: 'SLIP_NO',
      text_value: 'W7 오염검사',
    });
    await uploadImport(s.adminCtx, '검사.csv', Buffer.from('사용일,현장'));
    const after = await developmentCounts(url.toString());
    for (const name of [
      'vehicle_uses',
      'statements',
      'payment_records',
      'evidence',
      'audit_logs',
      'import_jobs',
    ])
      expect(after[name], name).toBeGreaterThan(before[name]);
  } finally {
    await isolated.cleanup();
  }
});
