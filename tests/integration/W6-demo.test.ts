import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { seedDemo } from '../../scripts/seed-demo';
import { getDashboard } from '../../src/server/services/dashboard';
import { defaultDatabaseUrl } from '../../src/server/db/client';
import {
  chargeLines,
  evidence,
  paymentRecords,
  statements,
  trips,
  vehicleUses,
  users,
} from '../../src/server/db/schema';
import { testDatabase } from '../helpers/database';

const database = testDatabase();
it('15: 서비스로 만든 9월 시연 데이터의 상태·수량·증빙·지급과 재실행 멱등성', async () => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? defaultDatabaseUrl());
  url.pathname = `/${database().name}`;
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/seed.ts'], {
    env: { ...process.env, DATABASE_URL: url.toString() },
  });
  const oldStorage = process.env.STORAGE_DIR;
  const storage = `.data/${database().name}-demo-storage`;
  process.env.STORAGE_DIR = storage;
  try {
    const result = await seedDemo(database().db);
    expect(result).toMatchObject({ created: true, count: 16 });
    expect(result.dashboard.review_pending).toBe(0);
    expect(result.dashboard.fix_pending).toBe(2);
    expect(result.dashboard.evidence_missing).toBe(2);
    expect(result.dashboard.unpaid_count).toBe(1);
    expect(result.dashboard.unpaid_amount).toBe(880000);
    expect(result.dashboard.unsettled_approved_amount).toBeGreaterThan(0);
    const uses = await database().db.select().from(vehicleUses);
    expect(new Set(uses.map((use) => use.driver_id)).size).toBe(2);
    expect(uses.filter((use) => use.use_date.startsWith('2026-09'))).toHaveLength(15);
    expect(uses.filter((use) => use.use_date.startsWith('2026-08'))).toHaveLength(1);
    expect(new Set(uses.map((use) => use.review_status))).toEqual(
      new Set(['DRAFT', 'SUBMITTED', 'NEEDS_FIX', 'APPROVED']),
    );
    const [site] = await database().db.select().from(users).where(eq(users.login_id, 'site'));
    expect(
      (await getDashboard({ db: database().db, user: site, request_id: crypto.randomUUID() })).review_pending,
    ).toBe(3);
    expect(uses.every((use) => use.reviewer_user_id === site.id && Number(use.load_tonnage) > 0)).toBe(true);
    const daily = uses.find((use) => use.client_request_id === 'demo-202609-use-01')!;
    expect(await database().db.select().from(trips).where(eq(trips.vehicle_use_id, daily.id))).toHaveLength(
      5,
    );
    const lines = await database().db.select().from(chargeLines);
    expect(lines.find((line) => line.vehicle_use_id === daily.id)).toMatchObject({
      quantity: '1.000',
      computed_amount: 300000,
      approved_amount: 300000,
    });
    expect(
      lines.some(
        (line) =>
          line.billing_unit === 'PER_TRIP' && line.quantity === '5.000' && line.computed_amount === 500000,
      ),
    ).toBe(true);
    expect(lines.some((line) => line.charge_type === 'WAITING' && line.line_review_status === 'HELD')).toBe(
      true,
    );
    expect(lines.some((line) => line.direction === 'RECEIVABLE' && line.approved_amount === 350000)).toBe(
      true,
    );
    expect(lines.some((line) => line.charge_type === 'BASE' && line.requested_amount === 330000)).toBe(true);
    const documents = await database().db.select().from(statements);
    expect(documents).toHaveLength(2);
    expect(documents.every((statement) => statement.status === 'CONFIRMED')).toBe(true);
    const paid = await database().db.select().from(paymentRecords);
    expect(paid).toHaveLength(1);
    expect(paid[0].amount).toBe(660000);
    const files = await database().db.select().from(evidence);
    expect(files).toHaveLength(14);
    expect(files.every((file) => file.upload_status === 'UPLOADED' && file.size! < 1000)).toBe(true);
    expect(await seedDemo(database().db)).toMatchObject({ created: false, count: 16 });
    expect(await database().db.select().from(statements)).toHaveLength(2);
  } finally {
    if (oldStorage === undefined) delete process.env.STORAGE_DIR;
    else process.env.STORAGE_DIR = oldStorage;
    await rm(storage, { recursive: true, force: true });
  }
});
