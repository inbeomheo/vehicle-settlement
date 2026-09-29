import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { eq } from 'drizzle-orm';
import { createDatabase, defaultDatabaseUrl } from '../src/server/db/client';
import { auditLogs, loginThrottles } from '../src/server/db/schema';
import { clientLoginIp, loginThrottleKey } from '../src/server/auth/login-throttle';

async function main() {
  const [option, value, extra] = process.argv.slice(2);
  if (!value || extra || !['--account', '--ip'].includes(option))
    throw new Error('사용법: npx tsx scripts/unlock-login.ts --account 아이디 또는 --ip 주소');
  if (option === '--ip' && value !== 'unavailable' && !isIP(value))
    throw new Error('올바른 IP 주소를 입력하세요.');
  const scope = option === '--account' ? 'ACCOUNT' : 'IP';
  let normalized = value;
  if (scope === 'IP' && value !== 'unavailable') {
    process.env.TRUSTED_CLIENT_IP_HEADER = 'x-unlock-ip';
    normalized = clientLoginIp(new Request('http://localhost', { headers: { 'x-unlock-ip': value } }));
  }
  const key = loginThrottleKey(scope, normalized);
  const { db, pool } = createDatabase(defaultDatabaseUrl());
  try {
    const count = await db.transaction(async (tx) => {
      const changed = await tx
        .update(loginThrottles)
        .set({
          failures: 0,
          locked_until: null,
          window_started_at: new Date(),
          updated_at: new Date(),
        })
        .where(eq(loginThrottles.key, key))
        .returning({ id: loginThrottles.id });
      await tx.insert(auditLogs).values({
        action: 'LOGIN_UNLOCKED',
        entity_type: 'session',
        request_id: randomUUID(),
        after: { throttle_key: key, scope, count: changed.length },
        reason: '시스템 관리자 수동 잠금 해제',
      });
      return changed.length;
    });
    console.log(`로그인 제한 ${count}건 해제 완료 (${scope === 'ACCOUNT' ? '계정' : 'IP'}).`);
  } finally {
    await pool.end();
  }
}
main().catch((error) => {
  console.error('로그인 잠금 해제 실패:', error instanceof Error ? error.message : '알 수 없는 오류');
  process.exitCode = 1;
});
