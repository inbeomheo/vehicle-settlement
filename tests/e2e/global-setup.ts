import { execFileSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from '../../src/server/db/client';

async function developmentCounts() {
  const client = new Client({ connectionString: process.env.E2E_DEVELOPMENT_DATABASE_URL });
  await client.connect();
  try {
    const tables = await client.query(
      "SELECT to_regclass('public.vehicle_uses') AS uses, to_regclass('public.statements') AS statements",
    );
    if (!tables.rows[0].uses || !tables.rows[0].statements) return { uses: 0, statements: 0 };
    const result = await client.query<{ uses: number; statements: number }>(
      'SELECT (SELECT count(*)::int FROM vehicle_uses) AS uses, (SELECT count(*)::int FROM statements) AS statements',
    );
    return result.rows[0];
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
    await migrate(database.db, { migrationsFolder: 'drizzle' });
  } finally {
    await database.pool.end();
  }
  const storage = path.resolve('.data/e2e-storage');
  if (path.resolve(process.env.STORAGE_DIR!) !== storage) throw new Error('E2E 증빙 경로가 잘못되었습니다.');
  await rm(storage, { force: true, recursive: true });
  await mkdir(storage, { recursive: true });
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/seed.ts'], { stdio: 'inherit' });
  console.log(`E2E 전용 DB 준비 완료. 개발 DB 전: 명세 ${before.statements}건, 사용 ${before.uses}건`);
  return async () => {
    const after = await developmentCounts();
    console.log(`개발 DB 후: 명세 ${after.statements}건, 사용 ${after.uses}건`);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error(`E2E가 개발 DB를 변경했습니다: ${JSON.stringify({ before, after })}`);
    }
  };
}
