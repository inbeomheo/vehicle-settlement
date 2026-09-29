import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { createUse, getUse, updateUse, submitUse } from '../../src/server/services/uses';
import { createEvidence } from '../../src/server/services/evidence';

const database = testDatabase();
it('기존 증빙의 버전 이력으로 귀속을 복원하고 이력 누락·충돌·넓은 공백은 null로 보존', async () => {
  const { db, pool } = database();
  const s = await setupScenario(db);
  const next = await s.f.driver();
  await s.f.affiliation(next.id, s.payee.id);
  const fixtures: { id: string; owner: string | null; useId: string; snapshot: unknown }[] = [];
  for (const mode of ['audit', 'revision', 'new-driver', 'missing', 'ambiguous', 'conflicting']) {
    let use = await createUse(s.adminCtx, s.input);
    if (mode === 'new-driver')
      use = await updateUse(s.adminCtx, use.id, { version: use.version, driver_id: next.id });
    const file = await createEvidence(s.adminCtx, use.id, {
      client_upload_id: randomUUID(),
      kind: 'CONFIRMATION',
      text_value: mode,
    });
    use = await getUse(s.adminCtx, use.id);
    if (mode === 'revision') use = await submitUse(s.adminCtx, use.id, { version: use.version });
    if (mode === 'audit' || mode === 'revision') {
      use = await updateUse(s.adminCtx, use.id, { version: use.version, driver_id: next.id });
    }
    if (mode === 'missing') await pool.query('DELETE FROM audit_logs WHERE entity_id=$1', [use.id]);
    if (mode === 'ambiguous') {
      // Only a much later current snapshot survives; do not infer ownership from it.
      await pool.query('UPDATE vehicle_uses SET version=20 WHERE id=$1', [use.id]);
    }
    if (mode === 'conflicting') {
      await pool.query(
        "INSERT INTO audit_logs(action,entity_type,entity_id,request_id,after) VALUES ('UPDATE','vehicle_use',$1,'conflict',$2)",
        [use.id, JSON.stringify({ ...use, driver_id: next.id })],
      );
    }
    fixtures.push({
      id: file.id,
      useId: use.id,
      owner: ['missing', 'ambiguous', 'conflicting'].includes(mode)
        ? null
        : mode === 'new-driver'
          ? next.id
          : s.driver.id,
      snapshot: use.revisions,
    });
  }
  const auditBefore = (await pool.query('SELECT id,before,after FROM audit_logs ORDER BY id')).rows;
  const revisionBefore = (await pool.query('SELECT id,snapshot FROM use_revisions ORDER BY id')).rows;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'DROP TRIGGER evidence_owner_immutable ON evidence; DROP FUNCTION preserve_evidence_owner(); ALTER TABLE evidence DROP COLUMN owner_driver_id',
    );
    await client.query(await readFile('drizzle/0410_f10_evidence_owner.sql', 'utf8'));
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  for (const fixture of fixtures) {
    const result = await pool.query('SELECT owner_driver_id FROM evidence WHERE id=$1', [fixture.id]);
    expect(result.rows[0].owner_driver_id, fixture.id).toBe(fixture.owner);
  }
  expect((await pool.query('SELECT id,before,after FROM audit_logs ORDER BY id')).rows).toEqual(auditBefore);
  expect((await pool.query('SELECT id,snapshot FROM use_revisions ORDER BY id')).rows).toEqual(
    revisionBefore,
  );
  await expect(
    pool.query('UPDATE evidence SET owner_driver_id=$1 WHERE id=$2', [next.id, fixtures[0].id]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    pool.query('UPDATE evidence SET owner_driver_id=$1 WHERE id=$2', [s.driver.id, fixtures[3].id]),
  ).rejects.toMatchObject({ code: '23514' });
});
