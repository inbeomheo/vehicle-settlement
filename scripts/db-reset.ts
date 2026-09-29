import { createDatabase, defaultDatabaseUrl } from '../src/server/db/client';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
async function main() {
  const url = new URL(defaultDatabaseUrl());
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/vehicle_app' || process.env.NODE_ENV === 'production') throw new Error('로컬 vehicle_app 데이터베이스만 초기화할 수 있습니다.');
  const { db, pool } = createDatabase(url.toString());
  try { await pool.query('DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public'); await migrate(db, { migrationsFolder: 'drizzle' }); console.log('로컬 DB 초기화 완료. seed를 실행하세요.'); } finally { await pool.end(); }
}
main().catch(e => { console.error(e); process.exit(1); });
