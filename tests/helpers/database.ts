import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll } from 'vitest';
import { Client } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase, defaultDatabaseUrl } from '../../src/server/db/client';
export async function createTestDatabase() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? defaultDatabaseUrl());
  const name = `test_${randomUUID().replaceAll('-', '')}`;
  url.pathname = '/postgres';
  const admin = new Client({ connectionString: url.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  url.pathname = `/${name}`;
  const { db, pool } = createDatabase(url.toString());
  try {
    await migrate(db, { migrationsFolder: 'drizzle' });
  } catch (e) {
    await pool.end();
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
    throw e;
  }
  return {
    db,
    pool,
    name,
    async cleanup() {
      await pool.end();
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      await admin.end();
    },
  };
}
// One real, isolated database per suite/file. Do not share this across test.concurrent cases.
export function testDatabase() {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database?.cleanup();
  });
  return () => database;
}
