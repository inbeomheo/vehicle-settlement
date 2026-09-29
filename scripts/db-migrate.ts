import { migrateDatabase } from '../src/server/db/migrate';
import { createDatabase, defaultDatabaseUrl } from '../src/server/db/client';
async function main() {
  const { db, pool } = createDatabase(defaultDatabaseUrl());
  try {
    await migrateDatabase(db);
    console.log('마이그레이션 완료');
  } finally {
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
