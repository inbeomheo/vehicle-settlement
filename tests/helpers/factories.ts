import { randomUUID } from 'node:crypto';
import type { Db } from '../../src/server/db/client';
import {
  companySettings,
  counterparties,
  driverAffiliations,
  drivers,
  projectAssignments,
  projects,
  rateAgreements,
  users,
  vehicles,
  workTypes,
} from '../../src/server/db/schema';
import { hashPassword } from '../../src/server/auth/password';
import { createSession } from '../../src/server/auth/session';
import type { Context } from '../../src/server/context';
const unique = () => randomUUID().slice(0, 8);
export function factories(db: Db) {
  return {
    async company(overrides: Partial<typeof companySettings.$inferInsert> = {}) {
      return (
        await db
          .insert(companySettings)
          .values({ name: '테스트 회사', ...overrides })
          .returning()
      )[0];
    },
    async project(overrides: Partial<typeof projects.$inferInsert> = {}) {
      return (
        await db
          .insert(projects)
          .values({ code: `P-${unique()}`, name: '테스트 현장', evidence_policy: 'NONE', ...overrides })
          .returning()
      )[0];
    },
    async counterparty(overrides: Partial<typeof counterparties.$inferInsert> = {}) {
      return (
        await db
          .insert(counterparties)
          .values({ name: '테스트 운송사', kind: 'CARRIER', ...overrides })
          .returning()
      )[0];
    },
    async vehicle(overrides: Partial<typeof vehicles.$inferInsert> = {}) {
      return (
        await db
          .insert(vehicles)
          .values({ plate_no: `서울-${unique()}`, vehicle_type: '카고', tonnage: '1', ...overrides })
          .returning()
      )[0];
    },
    async driver(overrides: Partial<typeof drivers.$inferInsert> = {}) {
      return (
        await db
          .insert(drivers)
          .values({ name: '테스트 기사', phone: '010-0000-0000', ...overrides })
          .returning()
      )[0];
    },
    async workType(overrides: Partial<typeof workTypes.$inferInsert> = {}) {
      return (
        await db
          .insert(workTypes)
          .values({ name: '운반', ...overrides })
          .returning()
      )[0];
    },
    async user(overrides: Partial<typeof users.$inferInsert> = {}) {
      return (
        await db
          .insert(users)
          .values({
            login_id: `user-${unique()}`,
            password_hash: await hashPassword('password1234'),
            name: '테스트 사용자',
            role: 'ADMIN',
            ...overrides,
          })
          .returning()
      )[0];
    },
    async assignment(
      userId: string,
      projectId: string,
      overrides: Partial<typeof projectAssignments.$inferInsert> = {},
    ) {
      return (
        await db
          .insert(projectAssignments)
          .values({ user_id: userId, project_id: projectId, valid_from: '2020-01-01', ...overrides })
          .returning()
      )[0];
    },
    async affiliation(
      driverId: string,
      counterpartyId: string,
      overrides: Partial<typeof driverAffiliations.$inferInsert> = {},
    ) {
      return (
        await db
          .insert(driverAffiliations)
          .values({
            driver_id: driverId,
            counterparty_id: counterpartyId,
            valid_from: '2020-01-01',
            ...overrides,
          })
          .returning()
      )[0];
    },
    async rate(counterpartyId: string, overrides: Partial<typeof rateAgreements.$inferInsert> = {}) {
      return (
        await db
          .insert(rateAgreements)
          .values({
            name: '일대 단가',
            direction: 'PAYABLE',
            counterparty_id: counterpartyId,
            billing_unit: 'PER_DAY',
            unit_price: 300000,
            valid_from: '2020-01-01',
            ...overrides,
          })
          .returning()
      )[0];
    },
    session(userId: string) {
      return createSession(db, userId);
    },
    context(user: typeof users.$inferSelect): Context {
      return { db, user, request_id: randomUUID() };
    },
  };
}
export async function setupScenario(
  db: Db,
  options: { evidence_policy?: typeof projects.$inferSelect.evidence_policy } = {},
) {
  const f = factories(db);
  const project = await f.project({ evidence_policy: options.evidence_policy ?? 'NONE' });
  const payee = await f.counterparty();
  const vehicle = await f.vehicle();
  const driver = await f.driver({ default_vehicle_id: vehicle.id });
  const affiliation = await f.affiliation(driver.id, payee.id);
  const rate = await f.rate(payee.id);
  const admin = await f.user();
  const driverUser = await f.user({ role: 'DRIVER', driver_id: driver.id });
  const assignment = await f.assignment(driverUser.id, project.id);
  return {
    f,
    project,
    payee,
    vehicle,
    driver,
    affiliation,
    rate,
    admin,
    driverUser,
    assignment,
    adminCtx: f.context(admin),
    driverCtx: f.context(driverUser),
    input: {
      reviewer_user_id: admin.id,
      load_tonnage: '1',
      use_date: '2026-09-15',
      project_id: project.id,
      driver_id: driver.id,
      vehicle_id: vehicle.id,
      trips: [{ seq: 1, origin: '상차장', destination: '현장' }],
    },
  };
}
