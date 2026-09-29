import { databaseSchemas } from '../src/server/db/config';
import { storageDriver } from '../src/server/storage';
import { cp, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultDatabaseUrl } from '../src/server/db/client';
import {
  connect,
  inventory,
  logicalDump,
  postgresBinary,
  runPostgres,
  tableList,
  tableName,
  verifyDatabase,
  writeManifest,
} from './backup-common';

export async function backup(options: {
  directory: string;
  url?: string;
  storage?: string;
  logical?: boolean;
}) {
  const url = options.url ?? defaultDatabaseUrl();
  const storage = path.resolve(options.storage ?? process.env.STORAGE_DIR ?? 'storage');
  const target = path.resolve(options.directory);
  const partial = `${target}.partial`;
  if (target === storage || target.startsWith(storage + path.sep))
    throw new Error('백업 경로는 storage 밖이어야 합니다.');
  await mkdir(partial, { recursive: false, mode: 0o700 });
  const { pool, client } = await connect(url);
  try {
    // The operator stops the app before backup. Locks also block concurrent DB mutations.
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const tables = await tableList(client);
    await client.query(
      `LOCK TABLE ${tables.map((t) => tableName(t.schemaname, t.tablename)).join(',')} IN SHARE MODE`,
    );
    const dump = options.logical || process.env.DB_SCHEMA ? null : await postgresBinary('pg_dump');
    const restore = options.logical || process.env.DB_SCHEMA ? null : await postgresBinary('pg_restore');
    const format = dump && restore ? 'pg-custom' : 'app-logical-v1';
    if (dump && restore) {
      const snapshot = (await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
      await runPostgres(
        dump,
        [
          '--format=custom',
          '--no-owner',
          '--no-acl',
          ...databaseSchemas().map((name) => `--schema=${name}`),
          `--snapshot=${snapshot}`,
          '--file',
          path.join(partial, 'database.dump'),
        ],
        url,
      );
    } else {
      console.log('pg_dump/pg_restore 없음: 앱 논리 백업(마이그레이션·원문 데이터·시퀀스) 사용');
      await writeFile(path.join(partial, 'database.json'), JSON.stringify(await logicalDump(client)), {
        mode: 0o600,
      });
    }
    await mkdir(path.join(partial, 'storage'), { mode: 0o700 });
    try {
      if (storageDriver() === 'local') {
        await inventory(storage); // Reject links before copying outside the storage tree.
        await cp(storage, path.join(partial, 'storage'), { recursive: true, dereference: false });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // Missing storage is valid only for a database without uploaded files; verified below.
    }
    const verified = await verifyDatabase(client, path.join(partial, 'storage'));
    const manifest = await writeManifest(partial, format);
    await client.query('COMMIT');
    await rename(partial, target);
    console.log(JSON.stringify({ backup: target, format, files: manifest.file_count, ...verified }));
    return manifest;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    await writeFile(
      path.join(partial, 'FAILED.txt'),
      `${new Date().toISOString()} 백업 실패\n${error instanceof Error ? error.message : '알 수 없는 오류'}\n`,
    ).catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const directory =
    process.argv[2] ?? path.join('.data', 'backups', new Date().toISOString().replaceAll(':', '-'));
  mkdir(path.dirname(path.resolve(directory)), { recursive: true, mode: 0o700 })
    .then(() => backup({ directory }))
    .catch((error) => {
      console.error('백업 실패:', error.message);
      process.exitCode = 1;
    });
}
