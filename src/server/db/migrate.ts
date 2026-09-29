import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { databaseSchema, migrationsSchema } from './config';
import legacyMigrations from './legacy-migrations.json';
import type { Database } from './client';
import journal from '../../../drizzle/meta/_journal.json';

// Drizzle compares the latest created_at, not hashes. Correct only the known
// W6 timestamp with its exact SQL hash, before subsequent migrations can run.
export async function migrateDatabase(db: Database) {
  const schema = databaseSchema();
  const historySchema = migrationsSchema();
  const history = sql`${sql.identifier(historySchema)}.${sql.identifier('__drizzle_migrations')}`;
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('vehicle:migrate', 0))`);
    const namespace = await tx.execute(sql`SELECT 1 FROM pg_namespace WHERE nspname=${schema}`);
    if (!namespace.rows.length)
      throw new Error(`DB_SCHEMA 스키마가 없습니다: ${schema}. 관리자가 먼저 생성하세요.`);
    const exists = await tx.execute(
      sql`SELECT to_regclass(${`${historySchema}.__drizzle_migrations`}) AS name`,
    );
    if (exists.rows[0].name) {
      const entry = journal.entries.find((item) => item.tag === '0100_w6_redact_invites')!;
      const hash = createHash('sha256')
        .update(await readFile(`drizzle/${entry.tag}.sql`))
        .digest('hex');
      await tx.execute(
        sql`UPDATE ${history} SET created_at=${entry.when} WHERE hash=${hash} AND created_at=1790660000000`,
      );
      // Only the two exact, known pre-DEPLOY SQL hashes may be normalized.
      for (const old of legacyMigrations) {
        const entry = journal.entries.find((item) => item.tag === old.tag)!;
        await tx.execute(
          sql`UPDATE ${history} SET hash=${old.hash} WHERE hash=${old.oldHash} AND created_at=${entry.when}`,
        );
      }
    }
    const config = { migrationsFolder: 'drizzle', migrationsSchema: historySchema };
    if (!process.env.DB_SCHEMA) {
      await migrate(tx as unknown as Database, config);
      return;
    }
    // Drizzle's stock migrator always issues CREATE SCHEMA. A restricted deployment
    // role must only use the pre-created namespace; keep its journal/ordering format.
    await tx.execute(
      sql`CREATE TABLE IF NOT EXISTS ${history} (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
    );
    const latest = await tx.execute(sql`SELECT created_at FROM ${history} ORDER BY created_at DESC LIMIT 1`);
    for (const migration of readMigrationFiles(config)) {
      if (latest.rows.length && Number(latest.rows[0].created_at) >= migration.folderMillis) continue;
      for (const statement of migration.sql) if (statement.trim()) await tx.execute(sql.raw(statement));
      await tx.execute(
        sql`INSERT INTO ${history} (hash, created_at) VALUES (${migration.hash}, ${migration.folderMillis})`,
      );
    }
  });
}
