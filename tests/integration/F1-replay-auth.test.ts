import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { callRoute } from '../helpers/routes';
import { users } from '../../src/server/db/schema';
import { createUse, submitUse } from '../../src/server/services/uses';
import { DELETE as cleanup } from '../../src/app/api/import/route';
import { POST as approve } from '../../src/app/api/uses/[id]/approve/route';
import { POST as requestFix } from '../../src/app/api/uses/[id]/request-fix/route';
import { PATCH as review } from '../../src/app/api/charge-lines/[id]/review/route';
import { POST as confirmByDriver } from '../../src/app/api/uses/[id]/confirm-by-driver/route';

const database = testDatabase();

it.each(['cleanup', 'approve', 'request-fix', 'review', 'confirm-by-driver'] as const)(
  '%s: 역할 변경 후 같은 멱등 키 재요청도 403',
  async (action) => {
    const s = await setupScenario(database().db);
    const created = await createUse(s.adminCtx, s.input);
    const use = await submitUse(s.adminCtx, created.id, { version: created.version });
    const driverAction = action === 'confirm-by-driver';
    const actor = driverAction ? s.driverUser : s.admin;
    if (!driverAction) await s.f.assignment(actor.id, s.project.id);
    const { token } = await s.f.session(actor.id);
    const actions = {
      cleanup: { handler: cleanup, method: 'DELETE', path: '/api/import', id: '', body: undefined },
      approve: {
        handler: approve,
        method: 'POST',
        path: `/api/uses/${use.id}/approve`,
        id: use.id,
        body: { version: use.version },
      },
      'request-fix': {
        handler: requestFix,
        method: 'POST',
        path: `/api/uses/${use.id}/request-fix`,
        id: use.id,
        body: {
          version: use.version,
          comment: '보완 필요',
          fix_items: [{ target: 'evidence', message: '증빙 추가' }],
        },
      },
      review: {
        handler: review,
        method: 'PATCH',
        path: `/api/charge-lines/${use.charge_lines[0].id}/review`,
        id: use.charge_lines[0].id,
        body: { version: use.version, line_review_status: 'APPROVED' },
      },
      'confirm-by-driver': {
        handler: confirmByDriver,
        method: 'POST',
        path: `/api/uses/${use.id}/confirm-by-driver`,
        id: use.id,
        body: { version: use.version },
      },
    };
    const entry = actions[action];
    const key = crypto.randomUUID();
    const request = (key: string) =>
      callRoute(database().db, entry.handler, {
        method: entry.method,
        path: entry.path,
        params: { id: entry.id },
        body: entry.body,
        token,
        headers: { 'idempotency-key': key },
      });
    expect((await request(key)).status).toBe(200);
    const replay = await request(key);
    expect(replay.status).toBe(200);
    expect(replay.headers.get('idempotency-replayed')).toBe('true');
    await database()
      .db.update(users)
      .set({ role: driverAction ? 'SITE_MANAGER' : 'DRIVER', driver_id: s.driver.id })
      .where(eq(users.id, actor.id));
    // Preserve project/driver read scope so role authorization is the reason for denial.
    expect((await request(key)).status).toBe(403);
    expect((await request(crypto.randomUUID())).status).toBe(403);
  },
);
