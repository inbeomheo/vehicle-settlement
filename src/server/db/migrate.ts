import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './client';
import journal from '../../../drizzle/meta/_journal.json';

// Drizzle compares the latest created_at, not hashes. Correct only the known
// W6 timestamp with its exact SQL hash, before subsequent migrations can run.
export async function migrateDatabase(db: Database) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('vehicle:migrate', 0))`);
    const exists = await tx.execute(sql`SELECT to_regclass('drizzle.__drizzle_migrations') AS name`);
    if (exists.rows[0].name) {
      const entry = journal.entries.find((item) => item.tag === '0100_w6_redact_invites')!;
      const hash = createHash('sha256')
        .update(await readFile(`drizzle/${entry.tag}.sql`))
        .digest('hex');
      await tx.execute(
        sql`UPDATE drizzle.__drizzle_migrations SET created_at=${entry.when} WHERE hash=${hash} AND created_at=1790660000000`,
      );
    }
    await migrate(tx as unknown as Database, { migrationsFolder: 'drizzle' });
  });
}
