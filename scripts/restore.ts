import { cp, mkdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultDatabaseUrl } from '../src/server/db/client';
import {
  connect,
  inventory,
  postgresBinary,
  quote,
  runPostgres,
  tableList,
  tableName,
  verifyDatabase,
  verifyManifest,
  type LogicalBackup,
} from './backup-common';

export async function restore(options: { directory: string; url?: string; storage?: string }) {
  const dir = path.resolve(options.directory);
  const manifest = await verifyManifest(dir); // Complete before changing any target data.
  const url = options.url ?? defaultDatabaseUrl();
  const storage = path.resolve(options.storage ?? process.env.STORAGE_DIR ?? 'storage');
  if (dir === storage || dir.startsWith(storage + path.sep) || storage.startsWith(dir + path.sep))
    throw new Error('복구 저장소와 백업 경로는 분리하세요.');
  await mkdir(storage, { recursive: true, mode: 0o700 });
  if ((await inventory(storage)).length)
    throw new Error('복구 대상 storage는 비어 있어야 합니다. 기존 파일을 별도로 보관하세요.');
  const staged = `${storage}.restore-${crypto.randomUUID()}`;
  await cp(path.join(dir, 'storage'), staged, { recursive: true });
  const { pool, client } = await connect(url);
  let moved = false;
  let nativeStarted = false;
  let databaseCommitted = false;
  try {
    for (const table of await tableList(client)) {
      if (table.schemaname === 'drizzle') continue;
      if (
        (await client.query(`SELECT 1 FROM ${tableName(table.schemaname, table.tablename)} LIMIT 1`)).rowCount
      )
        throw new Error('복구 대상 DB에 데이터가 있습니다. 빈 DB 또는 초기화한 DB에서 실행하세요.');
    }
    if (manifest.format === 'pg-custom') {
      const binary = await postgresBinary('pg_restore');
      if (!binary) throw new Error('이 백업에는 pg_restore가 필요합니다. PG_BIN을 지정하세요.');
      nativeStarted = true;
      await runPostgres(
        binary,
        [
          '--clean',
          '--if-exists',
          '--single-transaction',
          '--exit-on-error',
          '--no-owner',
          '--no-acl',
          '--dbname',
          new URL(url).pathname.slice(1),
          path.join(dir, 'database.dump'),
        ],
        url,
      );
      await verifyDatabase(client, staged);
    } else {
      const saved = JSON.parse(await readFile(path.join(dir, 'database.json'), 'utf8')) as LogicalBackup;
      if (saved.version !== 1) throw new Error('지원하지 않는 논리 백업 버전입니다.');
      await client.query('BEGIN');
      await client.query(
        'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public; CREATE SCHEMA drizzle',
      );
      await client.query(
        'CREATE TABLE drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)',
      );
      for (const migration of saved.migrations)
        for (const statement of migration.sql.split('--> statement-breakpoint'))
          if (statement.trim()) await client.query(statement);
      // Restore cyclic FKs without superuser-only replication settings, then validate every FK.
      const constraints = (
        await client.query(
          "SELECT n.nspname AS schema, t.relname AS table, c.conname AS name, pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE c.contype='f' AND n.nspname='public'",
        )
      ).rows;
      for (const c of constraints)
        await client.query(`ALTER TABLE ${tableName(c.schema, c.table)} DROP CONSTRAINT ${quote(c.name)}`);
      for (const table of saved.tables) {
        for (const row of table.rows)
          await client.query(
            `INSERT INTO ${tableName(table.schema, table.name)} (${table.columns.map(quote).join(',')}) VALUES (${row.map((_, i) => `$${i + 1}`).join(',')})`,
            row,
          );
      }
      for (const sequence of saved.sequences)
        await client.query('SELECT setval($1::regclass,$2::bigint,$3)', [
          tableName(sequence.schema, sequence.name),
          sequence.value,
          sequence.called,
        ]);
      for (const c of constraints)
        await client.query(
          `ALTER TABLE ${tableName(c.schema, c.table)} ADD CONSTRAINT ${quote(c.name)} ${c.definition}`,
        );
      await verifyDatabase(client, staged);
    }
    await rm(storage, { recursive: true }); // Target was checked empty above.
    await rename(staged, storage);
    moved = true;
    if (manifest.format === 'app-logical-v1') await client.query('COMMIT');
    databaseCommitted = true;
    const result = await verifyDatabase(client, storage);
    console.log(JSON.stringify({ restore: dir, result: '통과', ...result }));
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    // Native restore commits in its own process. After any later verification or
    // file move failure, compensate to an empty app DB (target was checked empty).
    if (nativeStarted || databaseCommitted) {
      try {
        await client.query('BEGIN');
        await client.query(
          'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public',
        );
        await client.query('COMMIT');
      } catch (cleanupError) {
        await client.query('ROLLBACK').catch(() => {});
        throw new AggregateError(
          [error, cleanupError],
          '복구 실패 후 빈 DB 초기화에도 실패했습니다. 앱을 중지하고 DB를 점검하세요.',
        );
      }
    }
    if (moved) await rm(storage, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(staged, { recursive: true, force: true });
    client.release();
    await pool.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.argv[2]) {
    console.error('사용법: npm run restore -- <백업 디렉터리>');
    process.exitCode = 1;
  } else
    restore({ directory: process.argv[2] }).catch((error) => {
      console.error('복구 실패:', error.message);
      process.exitCode = 1;
    });
}
