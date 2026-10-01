import { expect, it } from 'vitest';
import { testDatabase } from '../helpers/database';
import { migrateDatabase } from '../../src/server/db/migrate';
import legacy from '../../src/server/db/legacy-migrations.json';
import journal from '../../drizzle/meta/_journal.json';
import { logicalDump } from '../../scripts/backup-common';
import { setupScenario } from '../helpers/factories';

const database = testDatabase();
it('기존 public/drizzle 이력의 알려진 해시만 보정하고 업무 자료·테이블·시퀀스를 보존한다', async () => {
  await setupScenario(database().db);
  const client = await database().pool.connect();
  try {
    const before = await logicalDump(client);
    await client.query(
      'DROP TABLE driver_registrations, driver_join_links, evidence_blobs, password_resets, push_subscriptions',
    );
    await client.query('ALTER TABLE vehicle_uses DROP COLUMN reviewer_user_id, DROP COLUMN load_tonnage');
    await client.query('DELETE FROM drizzle.__drizzle_migrations WHERE created_at >= $1', [
      journal.entries.find((entry) => entry.tag === '0500_deploy_evidence_blobs')!.when,
    ]);
    // Match the old database's next journal id before applying the new migration.
    await client.query("SELECT setval('drizzle.__drizzle_migrations_id_seq', 8, true)");
    for (const entry of legacy) {
      const timestamp = journal.entries.find((migration) => migration.tag === entry.tag)!.when;
      await client.query('UPDATE drizzle.__drizzle_migrations SET hash=$1 WHERE hash=$2 AND created_at=$3', [
        entry.oldHash,
        entry.hash,
        timestamp,
      ]);
    }
    await migrateDatabase(database().db);
    await migrateDatabase(database().db);
    const after = await logicalDump(client);
    // SQL row order is unspecified; updating journal hashes may move heap tuples.
    for (const dump of [before, after])
      for (const table of dump.tables)
        table.rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    expect(after).toEqual(before);
    const timestamp = journal.entries.find((migration) => migration.tag === legacy[0].tag)!.when;
    await client.query('UPDATE drizzle.__drizzle_migrations SET hash=$1 WHERE created_at=$2', [
      'unknown-hash',
      timestamp,
    ]);
    await migrateDatabase(database().db);
    expect(
      (await client.query('SELECT hash FROM drizzle.__drizzle_migrations WHERE created_at=$1', [timestamp]))
        .rows[0].hash,
    ).toBe('unknown-hash');
    await expect(logicalDump(client)).rejects.toThrow('마이그레이션이 다릅니다');
  } finally {
    client.release();
  }
});
