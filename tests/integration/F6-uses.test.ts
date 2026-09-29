import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { chargeLines, rateAgreements } from '../../src/server/db/schema';
import { uploadImport, previewImport, commitImport } from '../../src/server/services/import';
import { getUse, updateUse } from '../../src/server/services/uses';
import { fromUse, toInput } from '../../src/components/use-form/model';
const database = testDatabase();

async function importedUse(price: number) {
  const s = await setupScenario(database().db);
  await database().db.delete(rateAgreements).where(eq(rateAgreements.id, s.rate.id));
  const header = [
    '사용일',
    '현장',
    '기사',
    '차량번호',
    '지급처',
    '출발지',
    '도착지',
    '과금단위',
    '청구수량',
    '단가',
  ];
  const row = [
    '2026-09-15',
    s.project.id,
    s.driver.id,
    s.vehicle.id,
    s.payee.id,
    '항구',
    '현장',
    '일대',
    '1',
    String(price),
  ];
  const job = await uploadImport(
    s.adminCtx,
    'F6.csv',
    Buffer.from([header, row].map((r) => r.join(',')).join('\n')),
  );
  await previewImport(s.adminCtx, job.id, {
    sheet: 0,
    header_row: 1,
    mapping: job.sheets[0].mapping,
    apply_contract_rate: false,
  });
  const result = await commitImport(s.adminCtx, job.id);
  return { s, use: await getUse(s.adminCtx, result.preview[0].use_id!) };
}

it.each([false, true])('R7-1 파일 단가를 비고·수량 편집에서 보존한다 (나중 계약=%s)', async (addContract) => {
  const { s, use } = await importedUse(100000);
  expect(use.charge_lines[0].agreement_snapshot).toMatchObject({ source: 'IMPORT' });
  if (addContract) await s.f.rate(s.payee.id, { unit_price: 300000 });
  const form = fromUse(JSON.parse(JSON.stringify(use)), 'manager');
  form.notes = '비고만 정정';
  const next = await updateUse(s.adminCtx, use.id, { ...toInput(form, 'manager'), version: use.version });
  expect(next.charge_lines[0]).toMatchObject({
    unit_price: 100000,
    computed_amount: 100000,
    price_status: 'CONFIRMED',
    agreement_snapshot: use.charge_lines[0].agreement_snapshot,
  });
  const quantity = await updateUse(s.adminCtx, use.id, { version: next.version, quantity: '2.5' });
  expect(quantity.charge_lines[0].computed_amount).toBe(250000);
});

it('R7-1 계약 없는 0원과 구버전 스냅샷 없는 저장 단가도 보존한다', async () => {
  const { s, use } = await importedUse(0);
  await database()
    .db.update(chargeLines)
    .set({ agreement_snapshot: null })
    .where(eq(chargeLines.id, use.charge_lines[0].id));
  await s.f.rate(s.payee.id, { unit_price: 300000 });
  const next = await updateUse(s.adminCtx, use.id, { version: use.version, quantity: '3' });
  expect(next.charge_lines[0]).toMatchObject({
    unit_price: 0,
    computed_amount: 0,
    price_status: 'CONFIRMED',
  });
});

it('R7-1 실제 사용일·과금단위 변경은 파일 단가 대신 계약을 다시 조회한다', async () => {
  const { s, use } = await importedUse(100000);
  await s.f.rate(s.payee.id, { unit_price: 300000 });
  let next = await updateUse(s.adminCtx, use.id, {
    version: use.version,
    use_date: '2026-09-16',
    quantity: '2',
  });
  expect(next.charge_lines[0].computed_amount).toBe(600000);
  next = await updateUse(s.adminCtx, use.id, {
    version: next.version,
    billing_unit: 'PER_TON',
    quantity: '2',
  });
  expect(next.charge_lines[0]).toMatchObject({ unit_price: null, price_status: 'PENDING' });
});
