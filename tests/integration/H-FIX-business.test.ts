import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { counterparties } from '../../src/server/db/schema';
import { getDriverProfile, updateDriverProfile } from '../../src/server/services/driver-profiles';
import { driverInformationSchema } from '../../src/server/services/driver-schemas';

const database = testDatabase();
const original = {
  representative_name: '원장 대표',
  address: '원장 주소',
  business_type: '원장 업태',
  business_item: '원장 종목',
};
const stale = {
  representative_name: '이전 대표',
  address: '이전 주소',
  business_type: '이전 업태',
  business_item: '이전 종목',
};
let serial = 0;
async function prepare() {
  const s = await setupScenario(database().db);
  const n = String(++serial).padStart(4, '0');
  const input = {
    name: s.driver.name,
    phone: `0107788${n}`,
    business_name: s.payee.name,
    biz_no: `777-00-0${n}`,
    plate_no: s.vehicle.plate_no,
    vehicle_type: '카고',
    tonnage: '1',
    version: 1,
  };
  await database()
    .db.update(counterparties)
    .set({ ...original, biz_no: input.biz_no, kind: 'DRIVER_BUSINESS' })
    .where(eq(counterparties.id, s.payee.id));
  return { s, input };
}

it.each(['DRIVER_BUSINESS', 'CARRIER'] as const)(
  '기존 %s로 소속 변경 시 이전 폼 상세와 상호가 원장을 덮어쓰지 않는다',
  async (kind) => {
    const { s, input } = await prepare();
    const target = await s.f.counterparty({
      ...original,
      name: '공유 원장 상호',
      biz_no: `888-00-${String(serial).padStart(5, '0')}`,
      kind,
    });
    await s.f.affiliation((await s.f.driver()).id, target.id);
    const updated = await updateDriverProfile(s.adminCtx, s.driverUser.id, {
      ...input,
      ...stale,
      business_name: '이전 상호',
      biz_no: target.biz_no,
    });
    expect.soft(updated).toMatchObject({ ...original, business_name: target.name, biz_no: target.biz_no });
    expect(
      (await database().db.select().from(counterparties).where(eq(counterparties.id, target.id)))[0],
    ).toMatchObject({ ...original, name: target.name });
  },
);

it.each(['past', 'future', 'carrier'] as const)(
  '기존 소속 유지도 공유/운송사 원장 보호: %s',
  async (sharing) => {
    const { s, input } = await prepare();
    if (sharing === 'carrier')
      await database()
        .db.update(counterparties)
        .set({ kind: 'CARRIER' })
        .where(eq(counterparties.id, s.payee.id));
    else
      await s.f.affiliation(
        (await s.f.driver({ active: false })).id,
        s.payee.id,
        sharing === 'past'
          ? { valid_from: '2020-01-01', valid_to: '2021-01-01' }
          : { valid_from: '2099-01-01' },
      );
    expect(
      await updateDriverProfile(s.adminCtx, s.driverUser.id, {
        ...input,
        ...stale,
        business_name: '이전 상호',
      }),
    ).toMatchObject({ ...original, business_name: s.payee.name });
  },
);

it('본인 전용 사업자 번호 유지 때만 상호·상세를 수정할 수 있다', async () => {
  const { s, input } = await prepare();
  expect(
    await updateDriverProfile(s.adminCtx, s.driverUser.id, {
      ...input,
      ...stale,
      business_name: '수정 상호',
    }),
  ).toMatchObject({ ...stale, business_name: '수정 상호' });
});

it.each(['admin', 'self'] as const)('사업자번호 없는 기존 CARRIER 소속 연락처 수정 (%s)', async (actor) => {
  const { s, input } = await prepare();
  await database()
    .db.update(counterparties)
    .set({ kind: 'CARRIER', biz_no: null })
    .where(eq(counterparties.id, s.payee.id));
  expect(
    await updateDriverProfile(actor === 'admin' ? s.adminCtx : s.driverCtx, s.driverUser.id, {
      ...input,
      biz_no: '',
    }),
  ).toMatchObject({ phone: input.phone, biz_no: null, business_name: s.payee.name });
  expect((await getDriverProfile(s.adminCtx, s.driverUser.id)).affiliations).toHaveLength(1);
});

it('새 사업자 생성에는 빈 번호를 허용하지 않는다', async () => {
  const { s, input } = await prepare();
  const { version: _version, ...registration } = input;
  void _version;
  expect(driverInformationSchema.safeParse(registration).success).toBe(true);
  expect(driverInformationSchema.safeParse({ ...registration, biz_no: '' }).success).toBe(false);
  await expect(
    updateDriverProfile(s.adminCtx, s.driverUser.id, { ...input, biz_no: '', business_name: '새 사업자' }),
  ).rejects.toThrow();
});
