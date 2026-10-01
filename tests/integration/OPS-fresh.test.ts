import { afterEach, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { defaultDatabaseUrl, createDatabase } from '../../src/server/db/client';
import { migrateDatabase } from '../../src/server/db/migrate';
const database = testDatabase();
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function url() {
  const value = new URL(process.env.TEST_DATABASE_URL ?? defaultDatabaseUrl());
  value.pathname = `/${database().name}`;
  return value.toString();
}
function fresh(schema = 'public') {
  return promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/start-fresh.ts'], {
    env: {
      ...process.env,
      DATABASE_URL: url(),
      DB_SCHEMA: schema,
      CONFIRM_FRESH_START: '지우기',
      APP_URL: 'http://localhost:3172',
    },
  });
}
it('초기화는 앱 외 테이블·시퀀스와 마이그레이션 기록을 보존한다', async () => {
  const { pool } = database();
  await setupScenario(database().db);
  await pool.query('CREATE TABLE other_app(id serial PRIMARY KEY); INSERT INTO other_app DEFAULT VALUES');
  const migrations = (await pool.query('SELECT * FROM drizzle.__drizzle_migrations')).rows;
  try {
    const result = await fresh();
    expect(result.stdout).toContain(database().name);
    expect(result.stdout).toContain('public');
    expect((await pool.query('SELECT * FROM other_app')).rows).toEqual([{ id: 1 }]);
    expect((await pool.query("SELECT nextval('other_app_id_seq') n")).rows[0].n).toBe('2');
    expect((await pool.query('SELECT * FROM drizzle.__drizzle_migrations')).rows).toEqual(migrations);
    expect((await pool.query('SELECT login_id FROM users')).rows).toEqual([{ login_id: 'admin' }]);
  } finally {
    await pool.query('DROP TABLE other_app');
  }
});
it('앱을 참조하는 다른 스키마 FK가 있으면 초기화 전체를 중단한다', async () => {
  const s = await setupScenario(database().db);
  const { pool } = database();
  await pool.query(
    'CREATE SCHEMA external_app; CREATE TABLE external_app.link(id uuid REFERENCES public.users(id))',
  );
  await pool.query('INSERT INTO external_app.link VALUES ($1)', [s.admin.id]);
  try {
    await expect(fresh()).rejects.toThrow();
    expect((await pool.query('SELECT id FROM external_app.link')).rows).toEqual([{ id: s.admin.id }]);
    expect((await pool.query('SELECT id FROM users WHERE id=$1', [s.admin.id])).rowCount).toBe(1);
  } finally {
    await pool.query('DROP SCHEMA external_app CASCADE');
  }
});
it('없는 DB_SCHEMA는 public으로 폴백하지 않고 중단한다', async () => {
  await expect(fresh('missing_schema')).rejects.toThrow();
});
it('전용 DB_SCHEMA 초기화는 같은 스키마 이력과 다른 스키마 앱을 보존한다', async () => {
  await database().pool.query('CREATE SCHEMA ops_app');
  vi.stubEnv('DB_SCHEMA', 'ops_app');
  const scoped = createDatabase(url());
  try {
    await migrateDatabase(scoped.db);
    await setupScenario(scoped.db);
    const publicUsers = (await database().pool.query('SELECT id FROM public.users ORDER BY id')).rows;
    const migrations = (await scoped.pool.query('SELECT * FROM __drizzle_migrations')).rows;
    const result = await fresh('ops_app');
    expect(result.stdout).toContain('DB_SCHEMA=ops_app');
    expect((await scoped.pool.query('SELECT * FROM __drizzle_migrations')).rows).toEqual(migrations);
    expect((await database().pool.query('SELECT id FROM public.users ORDER BY id')).rows).toEqual(
      publicUsers,
    );
    expect((await scoped.pool.query('SELECT login_id FROM users')).rows).toEqual([{ login_id: 'admin' }]);
  } finally {
    await scoped.pool.end();
    await database().pool.query('DROP SCHEMA ops_app CASCADE');
  }
});
