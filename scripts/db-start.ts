import 'dotenv/config';
import { Client } from 'pg';
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
async function connect() {
  const c = new Client({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.PG_PORT ?? 54329}/postgres`, connectionTimeoutMillis: 1000 });
  try { await c.connect(); return c; } catch { await c.end().catch(() => {}); return null; }
}
async function main() {
  let c = await connect();
  if (!c) {
    mkdirSync('.data', { recursive: true });
    const fd = openSync('.data/postgres.log', 'a');
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/db-daemon.ts'], { detached: true, stdio: ['ignore', fd, fd], env: process.env });
    child.unref(); closeSync(fd);
    for (let i = 0; i < 80 && !c; i++) { await setTimeout(250); c = await connect(); }
    if (!c) throw new Error('PostgreSQL 시작 실패: .data/postgres.log를 확인하세요.');
  }
  if (!(await c.query("SELECT 1 FROM pg_database WHERE datname='vehicle_app'")).rowCount) await c.query('CREATE DATABASE vehicle_app');
  await c.end(); console.log(`PostgreSQL 준비 완료 (127.0.0.1:${process.env.PG_PORT ?? 54329})`);
}
main().catch(e => { console.error(e); process.exit(1); });
