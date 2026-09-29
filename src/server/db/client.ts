import 'dotenv/config';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import { poolConfig } from './config';
export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Db = Database | Transaction;
export const defaultDatabaseUrl = () =>
  process.env.DATABASE_URL ??
  `postgresql://postgres:postgres@127.0.0.1:${process.env.PG_PORT ?? '54329'}/vehicle_app`;
export function createDatabase(url: string) {
  const pool = new Pool(poolConfig(url));
  return { db: drizzle(pool, { schema }), pool };
}
const globalDb = globalThis as unknown as { vehicleDb?: ReturnType<typeof createDatabase> };
const scope = new AsyncLocalStorage<Database>();
export function getDb(): Database {
  if (scope.getStore()) return scope.getStore()!;
  globalDb.vehicleDb ??= createDatabase(defaultDatabaseUrl());
  return globalDb.vehicleDb.db;
}
export function withDatabase<T>(db: Database, work: () => T): T {
  return scope.run(db, work);
}
