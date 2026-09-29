import type { Db } from './db/client';
import type { users } from './db/schema';
export type User = typeof users.$inferSelect;
export interface Context { db: Db; user: User; request_id: string; session_id?: string }
export function todaySeoul() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
