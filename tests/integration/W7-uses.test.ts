import { expect, it } from 'vitest';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { createUse, updateUse, listUses } from '../../src/server/services/uses';
const database = testDatabase();
it('8. 기존 고정 단위 라인에서 수량 생략 시 2.5와 계산 금액 보존', async () => {
  const s = await setupScenario(database().db);
  const use = await createUse(s.adminCtx, { ...s.input, quantity: '2.5' });
  const changed = await updateUse(s.adminCtx, use.id, {
    version: use.version,
    charge_lines: [{ id: use.charge_lines[0].id, charge_type: 'BASE', billing_unit: 'PER_DAY' }],
  });
  expect(changed.charge_lines[0]).toMatchObject({ quantity: '2.500', computed_amount: 750000 });
});
it('14. 기사 목록은 사용일 최신·동일 일자 입력순이며 PAYABLE 기본 금액만 반환', async () => {
  const s = await setupScenario(database().db);
  const a = await createUse(s.adminCtx, { ...s.input, use_date: '2026-09-20' });
  const b = await createUse(s.adminCtx, { ...s.input, use_date: '2026-09-20' });
  await createUse(s.adminCtx, { ...s.input, use_date: '2026-09-19' });
  const list = await listUses(s.driverCtx);
  expect(list.rows.map((r) => r.id).slice(0, 2)).toEqual([a.id, b.id]);
  expect(list.rows[0]).toMatchObject({ payable_base_amount: 300000 });
  expect(JSON.stringify(list)).not.toContain('RECEIVABLE');
});
