import { execFileSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { migrateDatabase } from '../../src/server/db/migrate';
import { createDatabase } from '../../src/server/db/client';

export async function developmentCounts(url = process.env.E2E_DEVELOPMENT_DATABASE_URL) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const counts: Record<string, number> = {};
    for (const table of [
      'vehicle_uses',
      'statements',
      'payment_records',
      'evidence',
      'audit_logs',
      'import_jobs',
    ]) {
      const exists = await client.query('SELECT to_regclass($1) AS name', [`public.${table}`]);
      counts[table] = exists.rows[0].name
        ? (await client.query(`SELECT count(*)::int AS count FROM "${table}"`)).rows[0].count
        : 0;
    }
    return counts;
  } finally {
    await client.end();
  }
}

export default async function setup() {
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/db-start.ts'], { stdio: 'inherit' });
  const url = new URL(process.env.DATABASE_URL!);
  if (url.pathname !== '/vehicle_e2e') throw new Error('E2E는 vehicle_e2e DB에서만 실행할 수 있습니다.');
  const before = await developmentCounts();
  url.pathname = '/postgres';
  const admin = new Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    await admin.query('DROP DATABASE IF EXISTS vehicle_e2e WITH (FORCE)');
    await admin.query('CREATE DATABASE vehicle_e2e');
  } finally {
    await admin.end();
  }
  const database = createDatabase(process.env.DATABASE_URL!);
  try {
    await migrateDatabase(database.db);
  } finally {
    await database.pool.end();
  }
  const storage = path.resolve('.data/e2e-storage');
  if (path.resolve(process.env.STORAGE_DIR!) !== storage) throw new Error('E2E 증빙 경로가 잘못되었습니다.');
  await rm(storage, { force: true, recursive: true });
  await mkdir(storage, { recursive: true });
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/seed.ts'], { stdio: 'inherit' });
  console.log(`E2E 전용 DB 준비 완료. 개발 DB 전: ${JSON.stringify(before)}`);
  return async () => {
    const after = await developmentCounts();
    console.log(`개발 DB 후: ${JSON.stringify(after)}`);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error(`E2E가 개발 DB를 변경했습니다: ${JSON.stringify({ before, after })}`);
    }
  };
}
