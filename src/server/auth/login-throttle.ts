import { isIP } from 'node:net';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { loginThrottles } from '../db/schema';
import { hashToken } from './password';

export const LOGIN_WINDOW_MS = 10 * 60 * 1000;
// Shared offices need room for independent typing mistakes; account protection stays at five.
export const LOGIN_IP_FAILURE_LIMIT = 100;
export const LOGIN_LOCK_MS = 15 * 60 * 1000;
export const loginThrottleKey = (scope: 'ACCOUNT' | 'IP', value: string) => hashToken(`${scope}:${value}`);
// Only an explicitly configured, proxy-overwritten single-IP header is trusted.
// Missing/invalid headers share a conservative bucket instead of bypassing limits.
export function clientLoginIp(request: Request): string {
  const header = process.env.TRUSTED_CLIENT_IP_HEADER;
  const value = header ? request.headers.get(header)?.trim() : undefined;
  if (!value || !isIP(value)) return 'unavailable';
  if (isIP(value) === 6) {
    // URL canonicalization prevents alternate IPv6 spellings creating buckets.
    return new URL(`http://[${value}]/`).hostname.slice(1, -1);
  }
  return value;
}
export async function lockLoginCounters(db: Db, loginId: string, ip: string) {
  const keys = [
    { scope: 'ACCOUNT' as const, key: loginThrottleKey('ACCOUNT', loginId) },
    { scope: 'IP' as const, key: loginThrottleKey('IP', ip) },
  ];
  return lockThrottleCounters(db, keys);
}
export async function lockThrottleCounters(db: Db, keys: { scope: 'ACCOUNT' | 'IP'; key: string }[]) {
  keys = [...keys].sort((a, b) => a.key.localeCompare(b.key));
  const counters = [];
  for (const key of keys) {
    await db.insert(loginThrottles).values(key).onConflictDoNothing();
    const [counter] = await db
      .select()
      .from(loginThrottles)
      .where(eq(loginThrottles.key, key.key))
      .for('update');
    counters.push(counter);
  }
  const result = await db.execute(sql`SELECT clock_timestamp() AS now`);
  return { counters, now: new Date(result.rows[0].now as string) };
}
export async function recordLoginFailure(db: Db, state: Awaited<ReturnType<typeof lockLoginCounters>>) {
  let locked = false;
  for (const counter of state.counters) {
    const expired = state.now.getTime() - counter.window_started_at.getTime() >= LOGIN_WINDOW_MS;
    const failures = expired ? 1 : counter.failures + 1;
    const threshold = counter.scope === 'ACCOUNT' ? 5 : LOGIN_IP_FAILURE_LIMIT;
    const lockedUntil = failures >= threshold ? new Date(state.now.getTime() + LOGIN_LOCK_MS) : null;
    locked ||= lockedUntil !== null;
    await db
      .update(loginThrottles)
      .set({
        failures,
        window_started_at: expired ? state.now : counter.window_started_at,
        locked_until: lockedUntil,
        updated_at: state.now,
      })
      .where(eq(loginThrottles.id, counter.id));
  }
  return locked;
}
