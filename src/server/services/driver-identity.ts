import { and, eq, sql } from 'drizzle-orm';
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
) {
  const today = todaySeoul();
  const duplicates = await db.execute(sql`SELECT id FROM drivers WHERE active
    AND id IS DISTINCT FROM ${driverId ?? null}::uuid
    AND (regexp_replace(phone, '[^0-9]', '', 'g')=${input.phone}
      OR default_vehicle_id IN (SELECT id FROM vehicles WHERE regexp_replace(upper(plate_no), '\\s', '', 'g')=${input.plate_no}))`);
  if (duplicates.rows.length)
    invalid('같은 전화번호 또는 차량번호가 다른 사용 중인 기사에 연결되어 있습니다. 관리자에게 문의하세요.');
  let [party] = await db
    .select()
    .from(counterparties)
    .where(
      and(
        allowExistingBusiness ? eq(counterparties.kind, 'DRIVER_BUSINESS') : undefined,
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
  if (party && !allowExistingBusiness && !ownsParty)
    invalid(
      '이미 등록된 사업자번호예요. 같은 사업자로 여러 대를 운행하시면 관리자에게 기사 추가(개별 초대)를 요청해 주세요.',
    );
  if (party && !party.active) invalid('사용 중지된 사업자입니다. 관리자에게 문의하세요.');
  if (!party)
    [party] = await db
      .insert(counterparties)
      .values({ name: input.business_name, biz_no: input.biz_no, kind: 'DRIVER_BUSINESS' })
      .returning();
  else if (
    driverId &&
    party.name !== input.business_name &&
    (
      await db.execute(
        sql`SELECT id FROM driver_affiliations WHERE driver_id=${driverId}::uuid AND counterparty_id=${party.id}::uuid AND valid_from<=${today}::date AND (valid_to IS NULL OR valid_to>=${today}::date)`,
      )
    ).rows.length
  ) {
    const others = await db.execute(
      sql`SELECT id FROM driver_affiliations WHERE counterparty_id=${party.id}::uuid AND driver_id<>${driverId}::uuid AND (valid_to IS NULL OR valid_to>=${today}::date)`,
    );
    if (others.rows.length)
      invalid(
        '여러 기사가 사용하는 상호는 여기서 변경할 수 없습니다. 기존 상호를 입력하거나 관리자에게 거래처 수정을 요청하세요.',
      );
    [party] = await db
      .update(counterparties)
      .set({ name: input.business_name, updated_at: new Date() })
      .where(eq(counterparties.id, party.id))
      .returning();
  }
  let [vehicle] = await db
    .select()
    .from(vehicles)
    .where(sql`regexp_replace(upper(${vehicles.plate_no}), '\\s', '', 'g')=${input.plate_no}`)
    .orderBy(vehicles.created_at, vehicles.id)
    .limit(1)
    .for('update');
  if (vehicle && !vehicle.active) invalid('사용 중지된 차량입니다. 관리자에게 문의하세요.');
  if (!vehicle)
    [vehicle] = await db
      .insert(vehicles)
      .values({ plate_no: input.plate_no, vehicle_type: input.vehicle_type, tonnage: input.tonnage })
      .returning();
  else
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
      await db
        .insert(driverAffiliations)
        .values({ driver_id: driver.id, counterparty_id: party.id, valid_from: today });
  }
  return driver;
}
