import { it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { withDatabase } from '../../src/server/db/client';
import { updateUser } from '../../src/server/services/admin';
import { POST as resetLinkRoute } from '../../src/app/api/admin/users/[id]/password-reset/route';

const database = testDatabase();
it.each(['SITE_MANAGER', 'DISABLED'] as const)(
  '관리자 권한 회수와 겹친 재설정 링크 발급은 잠금 뒤 재확인으로 거부된다: %s',
  async (change) => {
    const { db, pool } = database();
    const s = await setupScenario(db);
    const actor = await s.f.user({ role: 'ADMIN' });
    const session = await s.f.session(actor.id);
    let unlock!: () => void;
    let updated!: () => void;
    const ready = new Promise<void>((resolve) => (updated = resolve));
    const gate = new Promise<void>((resolve) => (unlock = resolve));
    const revocation = db.transaction(async (tx) => {
      await updateUser({ ...s.adminCtx, db: tx }, actor.id, {
        version: actor.version,
        ...(change === 'DISABLED' ? { status: 'DISABLED' } : { role: change }),
      });
      updated();
      await gate;
    });
    await ready;
    let pending: Promise<Response> | undefined;
    let response: Response;
    try {
      pending = withDatabase(db, () =>
        resetLinkRoute(
          new Request(`http://localhost/api/admin/users/${s.admin.id}/password-reset`, {
            method: 'POST',
            headers: { cookie: `sid=${session.token}` },
          }),
          { params: Promise.resolve({ id: s.admin.id }) },
        ),
      );
      let blocked = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const result = await pool.query(
          "SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.datname=current_database() AND l.locktype='advisory' AND NOT l.granted",
        );
        if (result.rowCount) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(typeof blocked).toBe('boolean');
    } finally {
      unlock();
      await revocation;
      response = await pending!;
    }
    const body = await response!.json();
    const state = (await db.execute(sql`SELECT role,status FROM users WHERE id=${actor.id}::uuid`)).rows[0];
    expect(state).toBeTruthy();
    expect(body.data?.reset_url).toBeUndefined();
    expect([401, 403]).toContain(response!.status);
  },
);
