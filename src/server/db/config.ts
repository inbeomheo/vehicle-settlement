import type { PoolConfig } from 'pg';

export function databaseSchema() {
  const name = process.env.DB_SCHEMA || 'public';
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name) || name.startsWith('pg_'))
    throw new Error('DB_SCHEMA는 소문자 영문·숫자·밑줄로 된 스키마 이름이어야 합니다.');
  return name;
}

export const migrationsSchema = () => (process.env.DB_SCHEMA ? databaseSchema() : 'drizzle');
export const databaseSchemas = () => [...new Set([databaseSchema(), migrationsSchema()])];

export function poolConfig(url: string): PoolConfig {
  const max = Number(process.env.PG_POOL_MAX ?? (process.env.VERCEL ? 3 : 10));
  if (!Number.isSafeInteger(max) || max < 1) throw new Error('PG_POOL_MAX는 양의 정수여야 합니다.');
  const parsed = new URL(url);
  parsed.searchParams.delete('options');
  const noVerify = process.env.PG_SSL_NO_VERIFY === '1';
  if (noVerify) {
    // pg connection-string SSL parameters otherwise replace the ssl object.
    for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'ssl']) parsed.searchParams.delete(key);
  }
  return {
    connectionString: parsed.toString(),
    max,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    options: `-c search_path=${databaseSchema()}`,
    ...(noVerify ? { ssl: { rejectUnauthorized: false } } : {}),
  };
}
