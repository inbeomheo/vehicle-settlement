import { sql } from 'drizzle-orm';
import type { Db } from './client';
export async function nextUseNo(db: Db, date: string) { const r = await db.execute<{ n: string }>(sql`SELECT nextval('use_no_seq')::text AS n`); return `U-${date.slice(2, 7).replace('-', '')}-${r.rows[0].n.padStart(5, '0')}`; }
export async function nextStatementNo(db: Db, direction: 'PAYABLE' | 'RECEIVABLE', date: string) { const r = await db.execute<{ n: string }>(sql`SELECT nextval('statement_no_seq')::text AS n`); return `${direction === 'PAYABLE' ? 'PAY' : 'BIL'}-${date.slice(0, 7).replace('-', '')}-${r.rows[0].n.padStart(4, '0')}`; }
