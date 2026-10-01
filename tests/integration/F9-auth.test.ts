import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { testDatabase } from '../helpers/database';
import { factories } from '../helpers/factories';
import { callRoute } from '../helpers/routes';
import { POST as loginRoute } from '../../src/app/api/auth/login/route';
import {
  clientLoginIp,
  loginThrottleKey,
  LOGIN_IP_FAILURE_LIMIT,
} from '../../src/server/auth/login-throttle';
import { acceptInviteSchema, loginSchema } from '../../src/server/services/schemas';
import { hashPassword, verifyPassword } from '../../src/server/auth/password';
import { login } from '../../src/server/services/auth';
import { auditLogs } from '../../src/server/db/schema';
const database = testDatabase();
describe('F9 인증', () => {
  it('UTF-8 72바이트 경계는 가입·로그인·해시/변경 모두 동일', async () => {
    const password = '가'.repeat(24);
    const over = password + 'a';
    expect(acceptInviteSchema.safeParse({ login_id: 'unicode', password }).success).toBe(true);
    expect(acceptInviteSchema.safeParse({ login_id: 'unicode', password: over }).success).toBe(false);
    expect(loginSchema.safeParse({ login_id: 'unicode', password: over }).success).toBe(false);
    await expect(hashPassword(over)).rejects.toThrow('비밀번호가 너무 깁니다');
    const hash = await hashPassword(password);
    await expect(verifyPassword(over, hash)).rejects.toThrow('비밀번호가 너무 깁니다');
    expect(await verifyPassword(password, hash)).toBe(true);
  });
  it('5회 실패 잠금·감사 보존·존재하지 않는 계정 동일 응답', async () => {
    const { db, pool } = database();
    const f = factories(db);
    const user = await f.user();
    const absent = randomUUID();
    for (const login_id of [user.login_id, absent]) {
      for (let i = 0; i < 5; i++) {
        const res = await callRoute(db, loginRoute, {
          method: 'POST',
          body: { login_id, password: 'wrong-password' },
        });
        expect(res.status).toBe(i === 4 ? 429 : 401);
      }
      const res = await callRoute(db, loginRoute, {
        method: 'POST',
        body: { login_id, password: 'password1234' },
      });
      expect(res.status).toBe(429);
      expect((await res.json()).error.message).toContain('15분');
    }
    const failed = await db.select().from(auditLogs).where(eq(auditLogs.action, 'LOGIN_FAILED'));
    expect(failed.length).toBe(12);
    expect(JSON.stringify(failed)).not.toContain('wrong-password');
    expect(
      (await pool.query('SELECT count(*)::int n FROM sessions WHERE user_id=$1', [user.id])).rows[0].n,
    ).toBe(0);
  });
  it('IP 실패는 다른 계정에도 공유하고 성공하면 계정 카운터만 초기화', async () => {
    const { db } = database();
    const user = await factories(db).user();
    const ip = '192.0.2.10';
    await db.execute(
      sql`INSERT INTO login_throttles (scope,key,failures) VALUES ('IP',${loginThrottleKey('IP', ip)},${LOGIN_IP_FAILURE_LIMIT - 20})`,
    );
    for (let i = 0; i < 20; i++) {
      await expect(
        login(db, randomUUID(), { login_id: randomUUID(), password: 'wrong' }, ip),
      ).rejects.toMatchObject({ status: i === 19 ? 429 : 401 });
    }
    await expect(
      login(db, randomUUID(), { login_id: user.login_id, password: 'password1234' }, ip),
    ).rejects.toMatchObject({ status: 429 });
    await expect(
      login(db, randomUUID(), { login_id: user.login_id, password: 'wrong' }, '192.0.2.11'),
    ).rejects.toMatchObject({ status: 401 });
    await login(db, randomUUID(), { login_id: user.login_id, password: 'password1234' }, '192.0.2.11');
    const result = await db.execute(
      sql`SELECT scope,failures FROM login_throttles WHERE key IN (${loginThrottleKey('ACCOUNT', user.login_id)}, ${loginThrottleKey('IP', '192.0.2.11')}) ORDER BY scope`,
    );
    expect(result.rows).toEqual([
      { scope: 'ACCOUNT', failures: 0 },
      { scope: 'IP', failures: 1 },
    ]);
  });
});

it('동시 로그인 실패는 계정별로 직렬화되고 만료 후 다시 로그인 가능', async () => {
  const { db, pool } = database();
  const user = await factories(db).user();
  const attempts = await Promise.allSettled(
    Array.from({ length: 6 }, (_, i) =>
      login(db, randomUUID(), { login_id: user.login_id, password: 'wrong' }, `198.51.100.${i}`),
    ),
  );
  const statuses = attempts.map((result) => (result.status === 'rejected' ? result.reason.status : 200));
  expect(statuses.filter((status) => status === 401)).toHaveLength(4);
  expect(statuses.filter((status) => status === 429)).toHaveLength(2);
  const key = loginThrottleKey('ACCOUNT', user.login_id);
  expect(
    (await pool.query('SELECT failures FROM login_throttles WHERE key=$1', [key])).rows[0].failures,
  ).toBe(5);
  await pool.query(
    "UPDATE login_throttles SET locked_until=now()-interval '1 second', window_started_at=now()-interval '20 minutes' WHERE key=$1",
    [key],
  );
  await expect(
    login(db, randomUUID(), { login_id: user.login_id, password: 'password1234' }, '198.51.100.20'),
  ).resolves.toHaveProperty('token');
  expect(
    (await pool.query('SELECT failures FROM login_throttles WHERE key=$1', [key])).rows[0].failures,
  ).toBe(0);
});
it('IP 헤더는 운영자가 지정한 단일 주소만 신뢰', () => {
  const prior = process.env.TRUSTED_CLIENT_IP_HEADER;
  try {
    delete process.env.TRUSTED_CLIENT_IP_HEADER;
    expect(
      clientLoginIp(new Request('http://localhost', { headers: { 'x-forwarded-for': '192.0.2.1' } })),
    ).toBe('unavailable');
    process.env.TRUSTED_CLIENT_IP_HEADER = 'x-real-ip';
    expect(clientLoginIp(new Request('http://localhost', { headers: { 'x-real-ip': '192.0.2.1' } }))).toBe(
      '192.0.2.1',
    );
    expect(
      clientLoginIp(new Request('http://localhost', { headers: { 'x-real-ip': '192.0.2.1,192.0.2.2' } })),
    ).toBe('unavailable');
  } finally {
    if (prior === undefined) delete process.env.TRUSTED_CLIENT_IP_HEADER;
    else process.env.TRUSTED_CLIENT_IP_HEADER = prior;
  }
});

it('관리자 CLI는 지정한 계정만 해제하고 감사 기록을 남긴다', async () => {
  const { db, pool } = database();
  const user = await factories(db).user();
  const key = loginThrottleKey('ACCOUNT', user.login_id);
  await expect(
    login(db, randomUUID(), { login_id: user.login_id, password: 'wrong' }, '203.0.113.1'),
  ).rejects.toMatchObject({ status: 401 });
  await pool.query(
    "UPDATE login_throttles SET failures=5, locked_until=now()+interval '15 minutes' WHERE key=$1",
    [key],
  );
  const output = execFileSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/unlock-login.ts', '--account', user.login_id],
    {
      env: { ...process.env, DATABASE_URL: pool.options.connectionString },
      encoding: 'utf8',
    },
  );
  expect(output).toContain('1건 해제 완료');
  expect(
    (await pool.query('SELECT failures, locked_until FROM login_throttles WHERE key=$1', [key])).rows[0],
  ).toEqual({ failures: 0, locked_until: null });
  expect(
    (
      await pool.query('SELECT failures FROM login_throttles WHERE key=$1', [
        loginThrottleKey('IP', '203.0.113.1'),
      ])
    ).rows[0].failures,
  ).toBe(1);
  const audit = await db.select().from(auditLogs).where(eq(auditLogs.action, 'LOGIN_UNLOCKED'));
  expect(audit).toHaveLength(1);
  expect(JSON.stringify(audit)).not.toContain(user.login_id);
});
