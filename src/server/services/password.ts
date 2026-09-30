import { and, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { audit } from '../audit';
import { hashPassword, hashToken, newToken, verifyPassword } from '../auth/password';
import { lockThrottleCounters, loginThrottleKey, recordLoginFailure } from '../auth/login-throttle';
import type { Context } from '../context';
import type { Db } from '../db/client';
import { loginThrottles, passwordResets, sessions, users } from '../db/schema';
import { AppError, invalid, notFound } from '../errors';
import { adminTransaction } from './admin';
import { acceptInviteSchema, loginSchema, uuid } from './schemas';
import { atomic } from './uses';

export const invalidResetMessage =
  '링크가 만료되었거나 이미 사용되었습니다. 관리자에게 새 링크를 요청하세요.';
const passwordFields = {
  password: acceptInviteSchema.shape.password,
  password_confirmation: z.string(),
};
const matches = (input: { password: string; password_confirmation: string }) =>
  input.password === input.password_confirmation;
const mismatch = { message: '새 비밀번호가 서로 다릅니다.', path: ['password_confirmation'] };
export const resetPasswordSchema = z.object(passwordFields).strict().refine(matches, mismatch);
export const changePasswordSchema = z
  .object({ ...passwordFields, current_password: loginSchema.shape.password })
  .strict()
  .refine(matches, mismatch);
const passwordCounter = (userId: string) => ({
  scope: 'ACCOUNT' as const,
  key: hashToken(`PASSWORD_CHANGE:${userId}`),
});
const loginCounter = (loginId: string) => ({
  scope: 'ACCOUNT' as const,
  key: loginThrottleKey('ACCOUNT', loginId),
});

export async function createPasswordReset(ctx: Context, userId: string) {
  uuid.parse(userId);
  return adminTransaction(ctx, async (tx) => {
    const [user] = await tx.db.select().from(users).where(eq(users.id, userId)).for('update');
    if (!user) notFound();
    if (user.status !== 'ACTIVE') invalid('비활성 사용자는 비밀번호 재설정 링크를 만들 수 없습니다.');
    const now = new Date();
    await revokePending(tx.db, userId, now);
    const token = newToken();
    const [reset] = await tx.db
      .insert(passwordResets)
      .values({
        user_id: userId,
        token_hash: hashToken(token),
        expires_at: new Date(now.getTime() + 86400000),
        created_by: tx.user.id,
      })
      .returning();
    const result = { id: reset.id, user_id: userId, expires_at: reset.expires_at };
    await audit(tx, 'CREATE_PASSWORD_RESET', 'password_reset', reset.id, null, result);
    return { ...result, reset_url: `${process.env.APP_URL ?? 'http://localhost:3000'}/reset/${token}` };
  });
}
async function revokePending(db: Db, userId: string, now: Date) {
  await db
    .update(passwordResets)
    .set({ revoked_at: now })
    .where(
      and(
        eq(passwordResets.user_id, userId),
        isNull(passwordResets.used_at),
        isNull(passwordResets.revoked_at),
      ),
    );
}
async function findReset(db: Db, token: string) {
  const [row] = await db
    .select({ reset: passwordResets, user: users })
    .from(passwordResets)
    .innerJoin(users, eq(users.id, passwordResets.user_id))
    .where(eq(passwordResets.token_hash, hashToken(token)));
  return row;
}
function usable(row: Awaited<ReturnType<typeof findReset>>) {
  return (
    row &&
    row.user.status === 'ACTIVE' &&
    !row.reset.used_at &&
    !row.reset.revoked_at &&
    row.reset.expires_at > new Date()
  );
}
export async function getPasswordResetStatus(db: Db, token: string) {
  const row = await findReset(db, token);
  return usable(row)
    ? { status: 'VALID' as const, name: row!.user.name, login_id: row!.user.login_id }
    : { status: 'INVALID' as const, name: null, login_id: null };
}
async function clearCounters(db: Db, state: Awaited<ReturnType<typeof lockThrottleCounters>>) {
  await db
    .update(loginThrottles)
    .set({ failures: 0, locked_until: null, window_started_at: state.now, updated_at: state.now })
    .where(
      inArray(
        loginThrottles.id,
        state.counters.map((counter) => counter.id),
      ),
    );
}
async function replacePassword(db: Db, userId: string, password: string, now: Date) {
  await db
    .update(users)
    .set({ password_hash: await hashPassword(password), updated_at: now, version: sql`${users.version} + 1` })
    .where(eq(users.id, userId));
}
export async function resetPassword(
  db: Db,
  requestId: string,
  token: string,
  raw: z.input<typeof resetPasswordSchema>,
) {
  const input = resetPasswordSchema.parse(raw);
  return db.transaction(async (tx) => {
    const initial = await findReset(tx, token);
    if (!usable(initial)) throw new AppError('NOT_FOUND', invalidResetMessage);
    // All authentication paths lock counters before the user, then links/sessions.
    const state = await lockThrottleCounters(tx, [
      loginCounter(initial!.user.login_id),
      passwordCounter(initial!.user.id),
    ]);
    const [user] = await tx.select().from(users).where(eq(users.id, initial!.user.id)).for('update');
    const row = await findReset(tx, token);
    if (!usable(row)) throw new AppError('NOT_FOUND', invalidResetMessage);
    const now = new Date();
    await replacePassword(tx, user.id, input.password, now);
    await tx.update(passwordResets).set({ used_at: now }).where(eq(passwordResets.id, row!.reset.id));
    await tx
      .update(sessions)
      .set({ revoked_at: now, updated_at: now })
      .where(and(eq(sessions.user_id, user.id), isNull(sessions.revoked_at)));
    await clearCounters(tx, state);
    await audit(
      { db: tx, user, request_id: requestId },
      'RESET_PASSWORD',
      'password_reset',
      row!.reset.id,
      null,
      { user_id: user.id },
    );
    return { changed: true };
  });
}
export async function changePassword(ctx: Context, raw: z.input<typeof changePasswordSchema>) {
  const input = changePasswordSchema.parse(raw);
  const outcome = await atomic(ctx, async (tx) => {
    const state = await lockThrottleCounters(tx.db, [passwordCounter(tx.user.id)]);
    const [user] = await tx.db.select().from(users).where(eq(users.id, tx.user.id)).for('update');
    const [session] = ctx.session_id
      ? await tx.db
          .select()
          .from(sessions)
          .where(
            and(
              eq(sessions.id, ctx.session_id),
              eq(sessions.user_id, user.id),
              isNull(sessions.revoked_at),
              gt(sessions.expires_at, new Date()),
            ),
          )
      : [];
    if (user.status !== 'ACTIVE' || !session) throw new AppError('UNAUTHENTICATED', '다시 로그인해 주세요.');
    const locked = state.counters.some((counter) => counter.locked_until && counter.locked_until > state.now);
    if (locked || !(await verifyPassword(input.current_password, user.password_hash))) {
      const throttled = locked || (await recordLoginFailure(tx.db, state));
      await audit(
        tx,
        'CHANGE_PASSWORD_FAILED',
        'user',
        user.id,
        null,
        null,
        throttled ? '비밀번호 확인 시도 제한' : '현재 비밀번호 불일치',
      );
      return { failure: throttled ? ('THROTTLED' as const) : ('INVALID' as const) };
    }
    const now = new Date();
    await replacePassword(tx.db, user.id, input.password, now);
    await tx.db
      .update(sessions)
      .set({ revoked_at: now, updated_at: now })
      .where(and(eq(sessions.user_id, user.id), ne(sessions.id, session.id), isNull(sessions.revoked_at)));
    await revokePending(tx.db, user.id, now);
    await clearCounters(tx.db, state);
    await audit(tx, 'CHANGE_PASSWORD', 'user', user.id);
    return { changed: true };
  });
  // Throw only after commit so failed attempts cannot roll back their counter.
  if (outcome.failure)
    throw new AppError(
      outcome.failure === 'THROTTLED' ? 'LOGIN_THROTTLED' : 'VALIDATION_FAILED',
      outcome.failure === 'THROTTLED'
        ? '비밀번호 확인 시도가 너무 많습니다. 15분 후 다시 시도하세요.'
        : '현재 비밀번호를 확인하세요.',
    );
  return { changed: true };
}
