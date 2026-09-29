import 'dotenv/config';
import { createHash } from 'node:crypto';
import { access, readdir, readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Pool, type PoolClient } from 'pg';
import { z } from 'zod';
import { defaultDatabaseUrl } from '../src/server/db/client';
import { databaseSchema, databaseSchemas, migrationsSchema, poolConfig } from '../src/server/db/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../src/server/db/schema';
import { readStoredFile, storageDriver, verifyStoredBytes } from '../src/server/storage';

export const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
export const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
export const tableName = (s: string, t: string) => `${quote(s)}.${quote(t)}`;
export const manifestSchema = z.object({
  version: z.literal(1),
  created_at: z.iso.datetime(),
  format: z.enum(['pg-custom', 'app-logical-v1']),
  db_schema: z.string().optional(),
  storage_driver: z.enum(['local', 'db']).optional(),
  file_count: z.number().int().nonnegative(),
  files: z.array(
    z.object({
      path: z.string(),
      size: z.number().int().nonnegative(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ),
});
export type Manifest = z.infer<typeof manifestSchema>;
export type LogicalBackup = {
  version: 1;
  migrations: { sql: string; hash: string; when: number }[];
  tables: { schema: string; name: string; columns: string[]; rows: (string | null)[][] }[];
  sequences: { schema: string; name: string; value: string; called: boolean }[];
};
export function safePath(root: string, relative: string) {
  const resolved = path.resolve(root, relative);
  if (
    path.isAbsolute(relative) ||
    relative.includes('\\') ||
    !resolved.startsWith(path.resolve(root) + path.sep)
  )
    throw new Error('백업 파일 경로가 올바르지 않습니다.');
  return resolved;
}
export async function inventory(root: string, prefix = ''): Promise<Manifest['files']> {
  const files: Manifest['files'] = [];
  for (const item of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, item.name);
    if (item.isSymbolicLink()) throw new Error(`심볼릭 링크는 백업할 수 없습니다: ${relative}`);
    if (item.isDirectory()) files.push(...(await inventory(root, relative)));
    else if (item.isFile()) {
      const bytes = await readFile(path.join(root, relative));
      files.push({ path: relative, size: bytes.length, sha256: digest(bytes) });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
export async function postgresBinary(name: 'pg_dump' | 'pg_restore') {
  const dirs = [
    process.env.PG_BIN,
    path.resolve(`node_modules/@embedded-postgres/${process.platform}-${process.arch}/native/bin`),
    ...(process.env.PATH ?? '').split(path.delimiter),
  ].filter(Boolean) as string[];
  for (const dir of dirs) {
    const candidate = path.join(dir, name + (process.platform === 'win32' ? '.exe' : ''));
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* Try the next installed binary. */
    }
  }
  return null;
}
export async function runPostgres(binary: string, args: string[], url: string) {
  const parsed = new URL(url);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, {
      env: {
        ...process.env,
        PGHOST: parsed.hostname,
        PGPORT: parsed.port || '5432',
        PGUSER: decodeURIComponent(parsed.username),
        PGPASSWORD: decodeURIComponent(parsed.password),
        PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)),
        ...(parsed.searchParams.get('sslmode') ? { PGSSLMODE: parsed.searchParams.get('sslmode')! } : {}),
      },
      stdio: ['ignore', 'inherit', 'pipe'],
    });
    let error = '';
    child.stderr.on('data', (chunk) => {
      error += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `${path.basename(binary)} 실패 (${code}): ${error.replaceAll(decodeURIComponent(parsed.password) || '\0', '***')}`,
            ),
          ),
    );
  });
}
export async function connect(url = defaultDatabaseUrl()) {
  const pool = new Pool({ ...poolConfig(url), max: 2, connectionTimeoutMillis: 10000 });
  try {
    const client = await pool.connect();
    return { pool, client };
  } catch (error) {
    await pool.end();
    throw error;
  }
}
export async function tableList(client: PoolClient) {
  return (
    await client.query<{ schemaname: string; tablename: string }>(
      'SELECT schemaname, tablename FROM pg_tables WHERE schemaname = ANY($1) ORDER BY schemaname, tablename',
      [databaseSchemas()],
    )
  ).rows;
}
// The deployment role owns objects, not CREATE privileges on the shared database.
// Preserve the namespace and its ACL; never reset public/drizzle in scoped mode.
export async function resetAppSchema(client: PoolClient) {
  if (!process.env.DB_SCHEMA) {
    await client.query(
      'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public',
    );
    return;
  }
  for (const table of await tableList(client))
    await client.query(`DROP TABLE IF EXISTS ${tableName(table.schemaname, table.tablename)} CASCADE`);
  const enums = (
    await client.query(
      "SELECT typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 AND t.typtype='e'",
      [databaseSchema()],
    )
  ).rows;
  for (const type of enums) await client.query(`DROP TYPE ${tableName(databaseSchema(), type.typname)}`);
  const sequences = (
    await client.query('SELECT sequencename FROM pg_sequences WHERE schemaname=$1', [databaseSchema()])
  ).rows;
  for (const sequence of sequences)
    await client.query(`DROP SEQUENCE ${tableName(databaseSchema(), sequence.sequencename)}`);
  const functions = (
    await client.query(
      'SELECT p.oid::regprocedure::text AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1',
      [databaseSchema()],
    )
  ).rows;
  for (const fn of functions) await client.query(`DROP FUNCTION ${fn.signature}`);
}
export async function logicalDump(client: PoolClient): Promise<LogicalBackup> {
  const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8')) as {
    entries: { tag: string; when: number }[];
  };
  const applied = (
    await client.query(
      `SELECT hash, created_at FROM ${tableName(migrationsSchema(), '__drizzle_migrations')} ORDER BY created_at`,
    )
  ).rows;
  const migrations = await Promise.all(
    journal.entries.map(async (entry) => {
      const text = await readFile(`drizzle/${entry.tag}.sql`, 'utf8');
      return { sql: text, hash: digest(text), when: entry.when };
    }),
  );
  if (
    applied.length !== migrations.length ||
    applied.some((r, i) => r.hash !== migrations[i].hash || Number(r.created_at) !== migrations[i].when)
  )
    throw new Error(
      'DB와 현재 마이그레이션이 다릅니다. 네이티브 pg_dump를 설치하거나 동일 버전 코드에서 백업하세요.',
    );
  const tables: LogicalBackup['tables'] = [];
  for (const t of await tableList(client)) {
    const columns = (
      await client.query<{ column_name: string }>(
        'SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position',
        [t.schemaname, t.tablename],
      )
    ).rows.map((c) => c.column_name);
    const result = await client.query({
      text: `SELECT ${columns.map((c) => `${quote(c)}::text`).join(',')} FROM ${tableName(t.schemaname, t.tablename)}`,
      rowMode: 'array',
    });
    tables.push({ schema: t.schemaname, name: t.tablename, columns, rows: result.rows });
  }
  const sequences: LogicalBackup['sequences'] = [];
  for (const s of (
    await client.query('SELECT schemaname, sequencename FROM pg_sequences WHERE schemaname = ANY($1)', [
      databaseSchemas(),
    ])
  ).rows) {
    const value = (
      await client.query(`SELECT last_value::text, is_called FROM ${tableName(s.schemaname, s.sequencename)}`)
    ).rows[0];
    sequences.push({
      schema: s.schemaname,
      name: s.sequencename,
      value: value.last_value,
      called: value.is_called,
    });
  }
  return { version: 1, migrations, tables, sequences };
}
export async function verifyDatabase(client: PoolClient, storage: string) {
  const evidence = (
    await client.query(
      "SELECT id, storage_key, sha256, size FROM evidence WHERE upload_status='UPLOADED' AND storage_key IS NOT NULL",
    )
  ).rows;
  for (const row of evidence) {
    if (!row.sha256) throw new Error(`증빙 해시 없음: ${row.id}`);
    const bytes = await readStoredFile(drizzle(client, { schema }), row.storage_key, storage);
    if (digest(bytes) !== row.sha256 || bytes.length !== row.size)
      throw new Error(`증빙 파일 해시/크기 불일치: ${row.id}`);
  }
  if (storageDriver() === 'db') {
    const blobs = (await client.query('SELECT bytes, size, sha256 FROM evidence_blobs')).rows;
    for (const blob of blobs) verifyStoredBytes(blob.bytes, blob.size, blob.sha256);
  }
  const imports = (
    await client.query(
      "SELECT rows->>'source_file' AS source FROM import_jobs WHERE rows->>'source_file' IS NOT NULL",
    )
  ).rows;
  for (const row of imports)
    await readStoredFile(drizzle(client, { schema }), `imports/${row.source}.xlsx`, storage);
  const orphan = await client.query(
    'SELECT e.id FROM evidence e LEFT JOIN vehicle_uses u ON u.id=e.vehicle_use_id WHERE u.id IS NULL',
  );
  if (orphan.rowCount) throw new Error('사용 건 없는 증빙 레코드가 있습니다.');
  const bad = await client.query(
    `SELECT s.id FROM statements s LEFT JOIN statement_items i ON i.statement_id=s.id AND i.inclusion='INCLUDED' WHERE s.status='CONFIRMED' GROUP BY s.id HAVING s.supply_total::bigint <> COALESCE(SUM(i.supply_amount),0) OR s.tax_total::bigint <> COALESCE(SUM(i.tax_amount),0) OR s.grand_total::bigint <> COALESCE(SUM(i.supply_amount::bigint+i.tax_amount),0) OR COUNT(i.id)=0 OR BOOL_OR(i.snapshot IS NULL OR (i.snapshot->>'supply_amount')::bigint IS DISTINCT FROM i.supply_amount::bigint OR (i.snapshot->>'tax_amount')::bigint IS DISTINCT FROM i.tax_amount::bigint OR i.supply_amount IS NULL OR i.tax_amount IS NULL OR NOT i.is_active_lock)`,
  );
  if (bad.rowCount)
    throw new Error(`확정명세 합계/스냅샷/잠금 불일치: ${bad.rows.map((s) => s.id).join(',')}`);
  const locks = await client.query(
    `SELECT i.id FROM statement_items i JOIN statements s ON s.id=i.statement_id LEFT JOIN charge_lines c ON c.id=i.charge_line_id WHERE s.status='CONFIRMED' AND i.inclusion='INCLUDED' AND (c.id IS NULL OR c.locked_statement_id IS DISTINCT FROM s.id)`,
  );
  if (locks.rowCount) throw new Error('확정명세 비용 연결 불일치');
  return {
    evidence_files: evidence.length,
    confirmed_statements: Number(
      (await client.query("SELECT count(*) FROM statements WHERE status='CONFIRMED'")).rows[0].count,
    ),
  };
}
export async function verifyManifest(dir: string) {
  const manifest = manifestSchema.parse(JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8')));
  if (
    manifest.file_count !== manifest.files.length ||
    new Set(manifest.files.map((f) => f.path)).size !== manifest.files.length
  )
    throw new Error('manifest 파일 수가 일치하지 않습니다.');
  const actual = (await inventory(dir)).filter((f) => f.path !== 'manifest.json');
  if (actual.length !== manifest.file_count) throw new Error('백업 파일 수가 일치하지 않습니다.');
  for (const file of manifest.files) {
    const target = safePath(dir, file.path);
    if (!(await stat(target)).isFile()) throw new Error(`백업 파일 없음: ${file.path}`);
    const bytes = await readFile(target);
    if (bytes.length !== file.size || digest(bytes) !== file.sha256)
      throw new Error(`백업 해시 불일치: ${file.path}`);
  }
  return manifest;
}
export async function writeManifest(dir: string, format: Manifest['format']) {
  const files = await inventory(dir);
  const manifest: Manifest = {
    version: 1,
    created_at: new Date().toISOString(),
    format,
    db_schema: databaseSchema(),
    storage_driver: storageDriver(),
    file_count: files.length,
    files,
  };
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  return manifest;
}
export async function ensureStorage(dir: string) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
}
