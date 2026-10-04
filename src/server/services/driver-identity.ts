import { businessDetails, businessDetailKeys } from './business-details';
import { approvedJoinBusiness } from './join-business';
import { and, eq, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import type { Db } from '../db/client';
import { counterparties, vehicles, drivers, driverAffiliations } from '../db/schema';
import { todaySeoul } from '../context';
import { invalid } from '../errors';
import type { DriverInformation } from './driver-schemas';

// Same lock as master edits: checking existing phone/plate/business and writing
// their related rows is one operation, even across different invitation links.
export async function lockDriverIdentity(db: Db) {
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('w3:administration', 0))`);
}
export async function saveDriverIdentity(
  db: Db,
  input: DriverInformation,
  driverId?: string,
  allowExistingBusiness = false,
  approvedCounterpartyId?: string,
) {
  const today = todaySeoul();
  const duplicates = await db.execute(sql`SELECT id FROM drivers WHERE active
    AND id IS DISTINCT FROM ${driverId ?? null}::uuid
    AND regexp_replace(phone, '[^0-9]', '', 'g')=${input.phone}`);
  if (duplicates.rows.length)
    invalid('같은 전화번호 또는 차량번호가 다른 사용 중인 기사에 연결되어 있습니다. 관리자에게 문의하세요.');
  // Prefer the current affiliation even when legacy duplicate business numbers
  // exist. A contact/vehicle edit must never turn a CARRIER into DRIVER_BUSINESS.
  const [currentParty] = driverId
    ? await db
        .select({ party: counterparties })
        .from(driverAffiliations)
        .innerJoin(counterparties, eq(counterparties.id, driverAffiliations.counterparty_id))
        .where(
          and(
            eq(driverAffiliations.driver_id, driverId),
            sql`${driverAffiliations.valid_from}<=${today}::date`,
            sql`(${driverAffiliations.valid_to} IS NULL OR ${driverAffiliations.valid_to}>=${today}::date)`,
          ),
        )
        .orderBy(sql`${driverAffiliations.valid_from} DESC`, driverAffiliations.id)
        .limit(1)
        .for('update')
    : [];
  const businessNumber = input.biz_no.replace(/\D/g, '');
  const sameBusiness = Boolean(
    currentParty && (currentParty.party.biz_no ?? '').replace(/\D/g, '') === businessNumber,
  );
  if (
    !approvedCounterpartyId &&
    !businessNumber &&
    (!sameBusiness || currentParty.party.name !== input.business_name)
  )
    invalid('새 사업자를 등록하려면 사업자번호를 입력하세요.');
  let [party] = approvedCounterpartyId
    ? [await approvedJoinBusiness(db, approvedCounterpartyId)]
    : sameBusiness
      ? [currentParty.party]
      : await db
          .select()
          .from(counterparties)
          .where(
            and(
              allowExistingBusiness
                ? sql`${counterparties.kind} IN ('DRIVER_BUSINESS','CARRIER')`
                : undefined,
              sql`regexp_replace(${counterparties.biz_no}, '[^0-9]', '', 'g')=${input.biz_no.replaceAll('-', '')}`,
            ),
          )
          .orderBy(counterparties.created_at, counterparties.id)
          .limit(1)
          .for('update');
  const ownsParty =
    party &&
    driverId &&
    (
      await db.execute(sql`SELECT 1 FROM driver_affiliations
    WHERE driver_id=${driverId}::uuid AND counterparty_id=${party.id}::uuid
    AND valid_from<=${today}::date AND (valid_to IS NULL OR valid_to>=${today}::date)`)
    ).rows.length > 0;
  if (party && !approvedCounterpartyId && !allowExistingBusiness && !ownsParty)
    invalid(
      '이미 등록된 사업자번호예요. 같은 사업자로 여러 대를 운행하시면 관리자에게 기사 추가(개별 초대)를 요청해 주세요.',
    );
  if (party && !party.active) invalid('사용 중지된 사업자입니다. 관리자에게 문의하세요.');
  if (!party)
    [party] = await db
      .insert(counterparties)
      .values({
        name: input.business_name,
        biz_no: input.biz_no,
        kind: 'DRIVER_BUSINESS',
        ...businessDetails(input),
      })
      .returning();
  else if (driverId && !approvedCounterpartyId) {
    const others = await db.execute(sql`SELECT 1 FROM driver_affiliations
      WHERE counterparty_id=${party.id}::uuid AND driver_id<>${driverId}::uuid LIMIT 1`);
    const editable = sameBusiness && ownsParty && party.kind === 'DRIVER_BUSINESS' && !others.rows.length;
    const changed =
      party.name !== input.business_name ||
      businessDetailKeys.some((key) => input[key] !== undefined && input[key] !== party[key]);
    if (changed && editable) {
      [party] = await db
        .update(counterparties)
        .set({ name: input.business_name, ...businessDetails(input), updated_at: new Date() })
        .where(eq(counterparties.id, party.id))
        .returning();
    } else if (changed && !allowExistingBusiness) {
      invalid('공유 운송사 사업자 정보는 여기서 변경할 수 없습니다. 관리자에게 거래처 수정을 요청하세요.');
    }
    // Admin affiliation edits reuse the master verbatim, even when old form details were sent.
  }
  let [vehicle] = await db
    .select()
    .from(vehicles)
    .where(sql`regexp_replace(upper(${vehicles.plate_no}), '\\s', '', 'g')=${input.plate_no}`)
    .orderBy(vehicles.created_at, vehicles.id)
    .limit(1)
    .for('update');
  if (vehicle && !vehicle.active) invalid('사용 중지된 차량입니다. 관리자에게 문의하세요.');
  let sharedVehicle = false;
  if (vehicle) {
    const others = await db.execute(sql`SELECT 1 WHERE
      EXISTS (SELECT 1 FROM drivers WHERE default_vehicle_id=${vehicle.id}::uuid
        AND id IS DISTINCT FROM ${driverId ?? null}::uuid)
      OR EXISTS (SELECT 1 FROM vehicle_uses WHERE vehicle_id=${vehicle.id}::uuid
        AND driver_id IS DISTINCT FROM ${driverId ?? null}::uuid
        AND (review_status='APPROVED' OR entered_as='PROXY'))`);
    sharedVehicle = others.rows.length > 0;
    if (sharedVehicle) {
      const [owner] = driverId ? await db.select().from(drivers).where(eq(drivers.id, driverId)) : [];
      if (
        owner?.default_vehicle_id !== vehicle.id ||
        vehicle.vehicle_type !== input.vehicle_type ||
        vehicle.tonnage === null ||
        !new Decimal(vehicle.tonnage).eq(input.tonnage)
      )
        invalid('이미 다른 기사님 차량으로 등록된 번호예요. 관리자에게 문의해 주세요.');
    }
  }
  if (!vehicle)
    [vehicle] = await db
      .insert(vehicles)
      .values({ plate_no: input.plate_no, vehicle_type: input.vehicle_type, tonnage: input.tonnage })
      .returning();
  else if (!sharedVehicle)
    [vehicle] = await db
      .update(vehicles)
      .set({ vehicle_type: input.vehicle_type, tonnage: input.tonnage, updated_at: new Date() })
      .where(eq(vehicles.id, vehicle.id))
      .returning();
  const values = { name: input.name, phone: input.phone, default_vehicle_id: vehicle.id };
  const [driver] = driverId
    ? await db
        .update(drivers)
        .set({ ...values, updated_at: new Date() })
        .where(eq(drivers.id, driverId))
        .returning()
    : await db.insert(drivers).values(values).returning();
  const current = await db
    .select()
    .from(driverAffiliations)
    .where(
      and(
        eq(driverAffiliations.driver_id, driver.id),
        sql`(${driverAffiliations.valid_to} IS NULL OR ${driverAffiliations.valid_to}>=${today}::date)`,
      ),
    )
    .for('update');
  if (!current.some((row) => row.counterparty_id === party.id && row.valid_from <= today)) {
    if (current.some((row) => row.valid_from > today))
      invalid('예약된 기사 소속이 있습니다. 관리자에게 소속 기간 확인을 요청하세요.');
    for (const row of current) {
      if (row.valid_from === today)
        await db
          .update(driverAffiliations)
          .set({ counterparty_id: party.id, updated_at: new Date() })
          .where(eq(driverAffiliations.id, row.id));
      else
        await db
          .update(driverAffiliations)
          .set({ valid_to: sql`${today}::date - 1`, updated_at: new Date() })
          .where(eq(driverAffiliations.id, row.id));
    }
    if (!current.some((row) => row.valid_from === today))
      await db.insert(driverAffiliations).values({
        driver_id: driver.id,
        counterparty_id: party.id,
        // Only a newly created driver receives a retrospective first affiliation.
        // Business/vehicle reuse does not change that driver's own history.
        valid_from: driverId ? today : sql`(${today}::date - interval '1 year')::date`,
      });
  }
  return driver;
}
