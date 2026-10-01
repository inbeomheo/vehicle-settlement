import { expect, it } from 'vitest';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { createUse } from '../../src/server/services/uses';
import { getApprovals } from '../../src/server/services/approvals';
const database = testDatabase();

it('기사 검색·담당자 선택지는 본인 현장 운행만 노출하고 검색·건수·금액도 같은 범위를 적용한다', async () => {
  const s = await setupScenario(database().db);
  const reviewer = await s.f.user({ name: '내 담당자' });
  const hiddenReviewer = await s.f.user({ name: '비공개 담당자' });
  const own = await createUse(s.driverCtx, {
    ...s.input,
    reviewer_user_id: reviewer.id,
    cargo_desc: '배관 100%',
    quantity: '1',
  });
  await createUse(s.driverCtx, { ...s.input, cargo_desc: '자재', quantity: '1' });
  const other = await s.f.driver();
  await s.f.affiliation(other.id, s.payee.id);
  await createUse(s.adminCtx, {
    ...s.input,
    driver_id: other.id,
    reviewer_user_id: hiddenReviewer.id,
    cargo_desc: '배관 100%',
  });
  const result = await getApprovals(s.driverCtx, { transport_search: '100%', reviewer_user_id: reviewer.id });
  expect(result.options.reviewers).toContainEqual({ id: reviewer.id, name: reviewer.name });
  expect(JSON.stringify(result)).not.toContain(hiddenReviewer.id);
  expect(result.rows.map((r) => r.id)).toEqual([own.id]);
  expect(result.counts.ALL).toBe(1);
  expect(result.summary).toMatchObject({ count: 1, amount: 300000 });
  expect((await getApprovals(s.driverCtx, { transport_search: '100%', driver_id: other.id })).total).toBe(0);
});
