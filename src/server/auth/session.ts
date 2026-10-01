import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { sessions, users, pushSubscriptions } from '../db/schema';
import { AppError } from '../errors';
import { hashToken, newToken } from './password';
import type { Context } from '../context';
export const SESSION_SECONDS = 30 * 24 * 60 * 60;
export async function createSession(db: Db, userId: string) {
  const token = newToken();
  const [session] = await db
    .insert(sessions)
    .values({
      user_id: userId,
      token_hash: hashToken(token),
      expires_at: new Date(Date.now() + SESSION_SECONDS * 1000),
    })
    .returning();
  return { token, session };
}
export function sessionCookie(token: string, clear = false) {
  return `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : SESSION_SECONDS}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}
export async function authenticate(db: Db, request: Request, requestId: string): Promise<Context> {
  const token = request.headers
    .get('cookie')
    ?.split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith('sid='))
    ?.slice(4);
  if (!token) throw new AppError('UNAUTHENTICATED', '로그인이 필요합니다.');
  const [row] = await db
    .select({ user: users, session: sessions })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.user_id))
    .where(eq(sessions.token_hash, hashToken(token)));
  if (
    !row ||
    row.user.status !== 'ACTIVE' ||
    row.session.revoked_at ||
    row.session.expires_at <= new Date()
  ) {
    if (row) {
      if (row.user.status !== 'ACTIVE') {
        await db
          .update(sessions)
          .set({ revoked_at: new Date(), updated_at: new Date() })
          .where(eq(sessions.user_id, row.user.id));
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.user_id, row.user.id));
      } else {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.session_id, row.session.id));
      }
    }
    throw new AppError('UNAUTHENTICATED', '다시 로그인해 주세요.');
  }
  await db
    .update(sessions)
    .set({ last_seen_at: new Date(), updated_at: new Date() })
    .where(eq(sessions.id, row.session.id));
  return { db, user: row.user, session_id: row.session.id, request_id: requestId };
}
export function publicUser(user: typeof users.$inferSelect) {
  const { password_hash: _hash, ...rest } = user;
  void _hash;
  return rest;
}
