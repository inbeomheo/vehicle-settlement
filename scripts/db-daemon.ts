import 'dotenv/config';
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import path from 'node:path';
async function main() {
  const dir = path.resolve('.data/pg');
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'postgres',
    password: 'postgres',
    port: Number(process.env.PG_PORT ?? 54329),
    persistent: true,
    postgresFlags: ['-h', '127.0.0.1'],
  });
  if (!existsSync(path.join(dir, 'PG_VERSION'))) await pg.initialise();
  await pg.start();
  process.on('SIGTERM', () => {
    void pg.stop().then(() => process.exit(0));
  });
  process.on('SIGINT', () => {
    void pg.stop().then(() => process.exit(0));
  });
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
