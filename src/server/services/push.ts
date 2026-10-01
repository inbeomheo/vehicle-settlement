import { and, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { pushSubscriptions, sessions, users } from '../db/schema';
import type { Context } from '../context';
import { assertActive } from '../authz';
import { audit } from '../audit';
import { AppError } from '../errors';
import { pushConfig } from '../push/config';

// Endpoints are server-side outbound requests. Accept browser push providers only.
export const pushEndpoint = z
  .url()
  .max(4096)
  .refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      (url.hostname === 'fcm.googleapis.com' ||
        url.hostname === 'updates.push.services.mozilla.com' ||
        url.hostname === 'web.push.apple.com' ||
        url.hostname.endsWith('.push.apple.com') ||
        url.hostname.endsWith('.notify.windows.com'))
    );
  }, '지원하는 브라우저의 알림 주소를 확인하세요.');
const key = (bytes: number) =>
  z
    .string()
    .max(Math.ceil(bytes / 3) * 4)
    .regex(/^[A-Za-z0-9_-]+={0,2}$/)
    .refine((value) => Buffer.from(value, 'base64url').length === bytes, '알림 구독 키를 확인하세요.');
export const pushSubscriptionInput = z
  .object({
    endpoint: pushEndpoint,
    keys: z.object({ p256dh: key(65), auth: key(16) }).strict(),
    expirationTime: z.number().nullable().optional(),
  })
  .strict();
export const pushEndpointInput = z.object({ endpoint: pushEndpoint }).strict();

export async function savePushSubscription(ctx: Context, raw: unknown, userAgent: string | null) {
  const input = pushSubscriptionInput.parse(raw);
  await assertActive(ctx);
  if (!pushConfig()) return { enabled: false, subscribed: false };
  return ctx.db.transaction(async (db) => {
    // Match password replacement's user -> session -> subscription lock order.
    const [user] = await db.select().from(users).where(eq(users.id, ctx.user.id)).for('update');
    const [session] = ctx.session_id
      ? await db
          .select()
          .from(sessions)
          .where(
            and(
              eq(sessions.id, ctx.session_id),
              eq(sessions.user_id, ctx.user.id),
              isNull(sessions.revoked_at),
              gt(sessions.expires_at, new Date()),
            ),
          )
          .for('update')
      : [];
    if (user?.status !== 'ACTIVE' || !session) throw new AppError('UNAUTHENTICATED', '다시 로그인해 주세요.');
    const [saved] = await db
      .insert(pushSubscriptions)
      .values({
        user_id: ctx.user.id,
        session_id: session.id,
        endpoint: input.endpoint,
        keys: input.keys,
        user_agent: userAgent?.slice(0, 512),
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          session_id: session.id,
          keys: input.keys,
          user_agent: userAgent?.slice(0, 512),
          updated_at: new Date(),
          failure_count: 0,
        },
        setWhere: eq(pushSubscriptions.user_id, ctx.user.id),
      })
      .returning({ id: pushSubscriptions.id });
    if (!saved) throw new AppError('FORBIDDEN', '이 기기의 기존 알림을 끈 뒤 다시 켜 주세요.');
    await audit({ ...ctx, db }, 'PUSH_SUBSCRIBE', 'push_subscription', saved.id);
    return { enabled: true, subscribed: true };
  });
}
export async function deletePushSubscription(ctx: Context, raw: unknown) {
  const input = pushEndpointInput.parse(raw);
  await assertActive(ctx);
  return ctx.db.transaction(async (db) => {
    const rows = await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.user_id, ctx.user.id), eq(pushSubscriptions.endpoint, input.endpoint)))
      .returning({ id: pushSubscriptions.id });
    for (const row of rows) await audit({ ...ctx, db }, 'PUSH_UNSUBSCRIBE', 'push_subscription', row.id);
    return { subscribed: false };
  });
}
export async function pushSubscriptionStatus(ctx: Context, raw: unknown) {
  const input = pushEndpointInput.parse(raw);
  await assertActive(ctx);
  const [row] = await ctx.db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.user_id, ctx.user.id), eq(pushSubscriptions.endpoint, input.endpoint)));
  return { subscribed: !!row };
}
