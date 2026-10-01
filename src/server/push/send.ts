import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import webPush from 'web-push';
import type { Db } from '../db/client';
import { chargeLines, pushSubscriptions, trips, users, vehicleUses } from '../db/schema';
import { assertCanReadUse, assertCanReview } from '../authz';
import { AppError } from '../errors';
import { pushConfig } from './config';

export type PushEvent = 'SUBMITTED' | 'NEEDS_FIX';
type Use = Pick<typeof vehicleUses.$inferSelect, 'project_id' | 'driver_id' | 'reviewer_user_id'>;
export async function pushRecipients(db: Db, use: Use, event: PushEvent, candidateId?: string) {
  const candidates = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.status, 'ACTIVE'),
        candidateId ? eq(users.id, candidateId) : undefined,
        event === 'NEEDS_FIX'
          ? and(eq(users.role, 'DRIVER'), eq(users.driver_id, use.driver_id))
          : use.reviewer_user_id
            ? eq(users.id, use.reviewer_user_id)
            : ne(users.role, 'DRIVER'),
      ),
    );
  const recipients: string[] = [];
  for (const user of candidates) {
    const ctx = { db, user, request_id: 'push' };
    try {
      if (event === 'SUBMITTED') await assertCanReview(ctx, use);
      else await assertCanReadUse(ctx, use);
      recipients.push(user.id);
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
    }
  }
  return recipients;
}

/** Best effort; called only after the outer idempotency transaction commits. */
export async function sendUsePush(db: Db, id: string, event: PushEvent, version: number) {
  const config = pushConfig();
  if (!config) return;
  try {
    const [use] = await db.select().from(vehicleUses).where(eq(vehicleUses.id, id));
    // Skip delayed notifications for already edited, reviewed or canceled work.
    if (!use || use.version !== version || use.review_status !== event || use.operation_status === 'CANCELED')
      return;
    const recipients = await pushRecipients(db, use, event);
    if (!recipients.length) return;
    // Lazy cleanup on delivery also handles devices that never request HTTP after expiry.
    await db
      .delete(pushSubscriptions)
      .where(
        and(
          inArray(pushSubscriptions.user_id, recipients),
          sql`${pushSubscriptions.session_id} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.id=${pushSubscriptions.session_id} AND s.user_id=${pushSubscriptions.user_id} AND s.revoked_at IS NULL AND s.expires_at>now())`,
        ),
      );
    const subscriptions = await db
      .select()
      .from(pushSubscriptions)
      .where(inArray(pushSubscriptions.user_id, recipients));
    const [trip] = await db
      .select()
      .from(trips)
      .where(and(eq(trips.vehicle_use_id, id), ne(trips.status, 'CANCELED')))
      .orderBy(trips.seq)
      .limit(1);
    const lines = await db
      .select()
      .from(chargeLines)
      .where(
        and(
          eq(chargeLines.vehicle_use_id, id),
          eq(chargeLines.direction, 'PAYABLE'),
          isNull(chargeLines.deleted_at),
          ne(chargeLines.line_review_status, 'REJECTED'),
        ),
      );
    let amount = 0n;
    let unknown = false;
    for (const line of lines) {
      const value = line.included_in_base
        ? 0
        : line.charge_type === 'BASE'
          ? (line.requested_amount ?? line.computed_amount)
          : (line.computed_amount ?? line.requested_amount);
      if (value === null) unknown = true;
      else amount += BigInt(value);
    }
    const snapshot = use.snapshot as Record<string, unknown>;
    const short = (value: unknown) => (typeof value === 'string' ? value.slice(0, 45) : '');
    const route = trip ? `${short(trip.origin)}→${short(trip.destination)}` : '운송내역';
    const body =
      event === 'SUBMITTED'
        ? `${short(snapshot.driver_name)} · ${short(snapshot.project_name)} · ${route} ${unknown ? '금액 확인 필요' : `${amount.toLocaleString('ko-KR')}원`} 확인 요청`
        : `${short(snapshot.project_name)} · ${route} 보완 요청이 있습니다. 내용을 확인해 주세요.`;
    const payload = JSON.stringify({
      title: event === 'SUBMITTED' ? '운행 확인 요청' : '운행 보완 요청',
      body,
      tag: `use-${id}-${event}-${use.current_revision_no}`,
      url: `/${event === 'SUBMITTED' ? 'm' : 'd'}/uses/${id}`,
    });
    // Small batches bound outgoing connections; failures never interrupt the business response.
    for (let start = 0; start < subscriptions.length; start += 10) {
      await Promise.allSettled(
        subscriptions.slice(start, start + 10).map(async (subscription) => {
          // Revalidate account/assignment and subscription ownership immediately before delivery.
          const [currentUse] = await db
            .select()
            .from(vehicleUses)
            .where(
              and(
                eq(vehicleUses.id, id),
                eq(vehicleUses.version, version),
                eq(vehicleUses.review_status, event),
                ne(vehicleUses.operation_status, 'CANCELED'),
              ),
            );
          if (!currentUse || !(await pushRecipients(db, currentUse, event, subscription.user_id)).length)
            return;
          const condition = and(
            eq(pushSubscriptions.id, subscription.id),
            // Legacy unbound subscriptions remain eligible only for active recipients.
            sql`(${pushSubscriptions.session_id} IS NULL OR EXISTS (SELECT 1 FROM sessions s WHERE s.id=${pushSubscriptions.session_id} AND s.user_id=${pushSubscriptions.user_id} AND s.revoked_at IS NULL AND s.expires_at>now()))`,
            sql`date_trunc('milliseconds', ${pushSubscriptions.updated_at}) = ${subscription.updated_at.toISOString()}::timestamptz`,
          );
          const [current] = await db
            .select({ id: pushSubscriptions.id })
            .from(pushSubscriptions)
            .where(condition);
          if (!current) return;
          try {
            await webPush.sendNotification(subscription, payload, {
              vapidDetails: config,
              TTL: 3600,
              timeout: 5000,
            });
            await db
              .update(pushSubscriptions)
              .set({ last_success_at: new Date(), failure_count: 0 })
              .where(condition);
          } catch (error) {
            const status =
              error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : null;
            if (status === 404 || status === 410) await db.delete(pushSubscriptions).where(condition);
            else
              await db
                .update(pushSubscriptions)
                .set({ failure_count: sql`${pushSubscriptions.failure_count} + 1` })
                .where(condition);
          }
        }),
      );
    }
  } catch {
    // No endpoints, personal details, keys, or provider response bodies in logs.
    console.warn('푸시 알림 처리 실패');
  }
}
