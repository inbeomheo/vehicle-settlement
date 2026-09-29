import { eq } from 'drizzle-orm';
import { createDatabase, defaultDatabaseUrl } from '../src/server/db/client';
import {
  companySettings,
  counterparties,
  drivers,
  driverAffiliations,
  projects,
  projectAssignments,
  rateAgreements,
  users,
  vehicles,
  workTypes,
} from '../src/server/db/schema';
import { hashPassword } from '../src/server/auth/password';
async function main() {
  const { db, pool } = createDatabase(defaultDatabaseUrl());
  try {
    await db.transaction(async (tx) => {
      if ((await tx.select().from(users).where(eq(users.login_id, 'admin'))).length) {
        console.log('데모 관리자가 이미 있습니다. 기존 데이터를 유지합니다.');
        return;
      }
      await tx
        .insert(companySettings)
        .values({
          name: '한결 건설',
          biz_no: '000-00-00000',
          address: '서울특별시',
          representative: '홍길동',
          settlement_contact: '정산팀 02-000-0000',
        })
        .onConflictDoNothing();
      const ps = await tx
        .insert(projects)
        .values([
          { code: 'SEOUL', name: '서울 현장', evidence_policy: 'PHOTO_REQUIRED' },
          { code: 'INCHEON', name: '인천 보안 현장', evidence_policy: 'PHOTO_OR_ALTERNATIVE' },
        ])
        .returning();
      const cs = await tx
        .insert(counterparties)
        .values([
          { name: '한길 운송', kind: 'CARRIER' },
          { name: '동서 운송', kind: 'CARRIER' },
          { name: '김기사 운수', kind: 'DRIVER_BUSINESS' },
          { name: '한빛 원청', kind: 'CUSTOMER' },
        ])
        .returning();
      const vs = await tx
        .insert(vehicles)
        .values([
          { plate_no: '서울80가1001', vehicle_type: '카고', tonnage: '1' },
          { plate_no: '서울80가5001', vehicle_type: '카고', tonnage: '5' },
          { plate_no: '인천80가1002', vehicle_type: '카고', tonnage: '1' },
        ])
        .returning();
      const ds = await tx
        .insert(drivers)
        .values([
          { name: '김기사', phone: '010-0000-0001', default_vehicle_id: vs[0].id },
          { name: '이기사', phone: '010-0000-0002', default_vehicle_id: vs[1].id },
        ])
        .returning();
      await tx
        .insert(driverAffiliations)
        .values(ds.map((d, i) => ({ driver_id: d.id, counterparty_id: cs[i].id, valid_from: '2020-01-01' })));
      await tx.insert(workTypes).values([{ name: '자재 운반' }, { name: '토사 운반' }]);
      await tx.insert(rateAgreements).values([
        {
          name: '1톤 일대',
          direction: 'PAYABLE',
          counterparty_id: cs[0].id,
          vehicle_type: '카고',
          tonnage: '1',
          billing_unit: 'PER_DAY',
          unit_price: 300000,
          valid_from: '2020-01-01',
        },
        {
          name: '5톤 회당',
          direction: 'PAYABLE',
          counterparty_id: cs[1].id,
          vehicle_type: '카고',
          tonnage: '5',
          billing_unit: 'PER_TRIP',
          unit_price: 100000,
          valid_from: '2020-01-01',
        },
        {
          name: '고객 청구 일대',
          direction: 'RECEIVABLE',
          counterparty_id: cs[3].id,
          billing_unit: 'PER_DAY',
          unit_price: 350000,
          valid_from: '2020-01-01',
        },
      ]);
      const hash = await hashPassword('demo1234');
      const us = await tx
        .insert(users)
        .values([
          {
            login_id: 'admin',
            password_hash: await hashPassword('admin1234'),
            name: '관리자',
            role: 'ADMIN',
            all_projects: true,
          },
          { login_id: 'site', password_hash: hash, name: '현장 담당자', role: 'SITE_MANAGER' },
          {
            login_id: 'settlement',
            password_hash: hash,
            name: '정산 담당자',
            role: 'SETTLEMENT_MANAGER',
            all_projects: true,
          },
          { login_id: 'driver1', password_hash: hash, name: '김기사', role: 'DRIVER', driver_id: ds[0].id },
          { login_id: 'driver2', password_hash: hash, name: '이기사', role: 'DRIVER', driver_id: ds[1].id },
        ])
        .returning();
      await tx
        .insert(projectAssignments)
        .values(
          us.flatMap((u) => ps.map((p) => ({ user_id: u.id, project_id: p.id, valid_from: '2020-01-01' }))),
        );
      console.log('데모 데이터 생성 완료: admin / admin1234, site·settlement·driver1·driver2 / demo1234');
    });
  } finally {
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
