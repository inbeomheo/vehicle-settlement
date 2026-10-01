import { afterEach, expect, it, vi } from 'vitest';
import { testDatabase } from '../helpers/database';
import { sql } from 'drizzle-orm';
import { defaultDatabaseUrl, createDatabase, withDatabase } from '../../src/server/db/client';
import { safeRoute, safeError } from '../../src/server/safe-error';
import { poolConfig } from '../../src/server/db/config';
import { withRoute } from '../../src/server/http';
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
it('실제 DB 오류의 SQL·파라미터·원문은 로그에 남지 않는다', async () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const route = withRoute(
    async ({ db }) => db.execute(sql`SELECT ${'개인정보01012345678계좌123'}::integer`),
    { auth: false, source: 'none' },
  );
  const response = await withDatabase(database().db, () =>
    route(new Request('http://localhost:3172/api/uses?phone=01012345678'), { params: Promise.resolve({}) }),
  );
  expect(response.status).toBe(500);
  const logs = JSON.stringify(spy.mock.calls);
  expect(logs).not.toContain('개인정보');
  expect(logs).not.toContain('01012345678');
  expect(logs).not.toContain('SELECT');
  expect(logs).toContain('22P02');
  expect(logs).toContain('/api/uses');
  expect(logs).toContain(response.headers.get('x-request-id'));
});
it('풀은 유휴 연결 강제 종료 뒤에도 다음 쿼리를 처리한다', async () => {
  const connection = createDatabase(url());
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect(connection.pool.listenerCount('error')).toBeGreaterThan(0);
    const { rows } = await connection.pool.query('SELECT pg_backend_pid() pid');
    await database().pool.query('SELECT pg_terminate_backend($1)', [rows[0].pid]);
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    expect((await connection.pool.query('SELECT 42 n')).rows[0].n).toBe(42);
    expect(poolConfig(url()).connectionTimeoutMillis).toBeGreaterThan(0);
    expect(poolConfig(url()).idleTimeoutMillis).toBeGreaterThan(0);
  } finally {
    await connection.pool.end();
  }
});
it('로그 라우트의 토큰·쿼리와 오류의 이름·메시지·순환 cause도 원문을 남기지 않는다', () => {
  expect(
    safeRoute(
      new Request('http://localhost:3172/api/invites/secret-token/accept?phone=01012345678', {
        method: 'POST',
      }),
    ),
  ).toBe('POST /api/invites/:id/accept');
  const error = { name: '개인정보', message: '전화번호', cause: {} };
  error.cause = error;
  expect(JSON.stringify(safeError(error))).not.toMatch(/개인정보|전화번호/);
});
