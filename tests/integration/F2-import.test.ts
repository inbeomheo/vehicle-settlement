import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { importJobs, rateAgreements, vehicleUses } from '../../src/server/db/schema';
import { uploadImport, previewImport, commitImport } from '../../src/server/services/import';
import { approveUse, getUse, submitUse, updateUse } from '../../src/server/services/uses';
import { createStatement, confirmStatement, getStatement } from '../../src/server/services/statements';
import { recordPayment } from '../../src/server/services/payments';
import { recalculateImportHashes } from '../../src/server/services/import-rehash';

const database = testDatabase();
type Scenario = Awaited<ReturnType<typeof setupScenario>>;
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
function row(s: Scenario, destination: string, price = '') {
  return [
    '2026-09-15',
    s.project.id,
    s.driver.id,
    s.vehicle.id,
    s.payee.id,
    '항구',
    destination,
    '일대',
    '1',
    price,
  ];
}
async function preview(
  s: Scenario,
  rows: string[][],
  newline = '\n',
  reverseColumns = false,
  apply = true,
  excluded_rows: number[] = [],
) {
  const values = [header, ...rows].map((cells) => (reverseColumns ? [...cells].reverse() : cells));
  const job = await uploadImport(
    s.adminCtx,
    '재저장.csv',
    Buffer.from(values.map((cells) => cells.join(',')).join(newline)),
  );
  return previewImport(s.adminCtx, job.id, {
    sheet: 0,
    header_row: 1,
    mapping: job.sheets[0].mapping,
    apply_contract_rate: apply,
    excluded_rows,
  });
}
async function legacyImport(s: Scenario, rows: string[][], excluded: number[] = []) {
  // The pre-F1 hash used the applied 300,000-won contract price for a blank cell.
  const old = await preview(
    s,
    rows.map((cells) => [...cells.slice(0, -1), cells.at(-1) || '300000']),
  );
  const first = await preview(s, rows, '\n', false, true, excluded);
  const imported = await commitImport(s.adminCtx, first.id);
  const [job] = await database().db.select().from(importJobs).where(eq(importJobs.id, imported.id));
  const payload = job.rows as { preview: typeof imported.preview };
  for (const [index, result] of payload.preview.entries()) {
    result.source_row_hash = old.preview[index].source_row_hash;
    delete result.source_ids;
    if (result.use_id)
      await database()
        .db.update(vehicleUses)
        .set({ source_row_hash: result.source_row_hash })
        .where(eq(vehicleUses.id, result.use_id));
  }
  await database().db.update(importJobs).set({ rows: payload }).where(eq(importJobs.id, job.id));
  return imported;
}

it.each(['CRLF', '행 이동', '열 매핑 변경'] as const)(
  '구버전 해시 재계산: %s 재저장과 계약 변경 후에도 등록·이중 지급을 막는다',
  async (variant) => {
    const s = await setupScenario(database().db);
    const rows = [row(s, 'A현장'), row(s, 'B현장')];
    const original = await legacyImport(s, rows);
    const useIds = original.preview.map((r) => r.use_id!);
    const lineIds: string[] = [];
    for (const id of useIds) {
      let use = await getUse(s.adminCtx, id);
      use = await updateUse(s.adminCtx, id, {
        version: use.version,
        reviewer_user_id: s.admin.id,
        load_tonnage: '1',
      });
      use = await submitUse(s.adminCtx, id, { version: use.version });
      use = await approveUse(s.adminCtx, id, { version: use.version });
      lineIds.push(...use.charge_lines.map((line) => line.id));
    }
    let statement = await createStatement(s.adminCtx, {
      client_request_id: crypto.randomUUID(),
      direction: 'PAYABLE',
      counterparty_id: s.payee.id,
      period_start: '2026-09-01',
      period_end: '2026-09-30',
      items: lineIds.map((charge_line_id) => ({ charge_line_id })),
    });
    statement = await confirmStatement(s.adminCtx, statement.id, {
      version: statement.version,
      confirmation_token: statement.confirmation_token!,
    });
    await recordPayment(s.adminCtx, statement.id, {
      client_request_id: crypto.randomUUID(),
      kind: 'PAYMENT',
      amount: statement.grand_total,
      paid_on: '2026-09-29',
      method: '계좌이체',
    });
    const before = await getStatement(s.adminCtx, statement.id);
    await database().db.update(rateAgreements).set({ active: false }).where(eq(rateAgreements.id, s.rate.id));
    await s.f.rate(s.payee.id, { project_id: s.project.id, unit_price: 400000 });
    await recalculateImportHashes(database().db);
    const incoming = variant === '행 이동' ? [rows[1], [], rows[0]] : rows;
    const jobs = await Promise.all(
      [true, false].map((apply) => preview(s, incoming, '\r\n', variant === '열 매핑 변경', apply)),
    );
    expect(jobs.map((job) => job.summary?.skipped)).toEqual([2, 2]);
    const results = await Promise.all(jobs.map((job) => commitImport(s.adminCtx, job.id)));
    expect(results.map((job) => job.summary?.success)).toEqual([0, 0]);
    expect(
      await database().db.select().from(vehicleUses).where(eq(vehicleUses.project_id, s.project.id)),
    ).toHaveLength(2);
    expect(await getStatement(s.adminCtx, statement.id)).toEqual(before);
  },
);

it('구버전 반복 행 재계산은 제외 순서를 보존하고 추가 반복·명시적 0원·단가 변경을 구분한다', async () => {
  const s = await setupScenario(database().db);
  const repeated = row(s, '반복현장');
  const original = await legacyImport(s, [repeated, repeated], [2]);
  expect(original.summary?.success).toBe(1);
  await recalculateImportHashes(database().db);
  const next = await preview(
    s,
    [[], repeated, repeated, repeated, row(s, '반복현장', '0'), row(s, '반복현장', '500000')],
    '\r\n',
  );
  expect(next.preview.map((r) => r.status)).toEqual(['VALID', 'SKIPPED', 'VALID', 'VALID', 'VALID']);
  expect((await commitImport(s.adminCtx, next.id)).summary?.success).toBe(4);
  const again = await preview(s, [
    repeated,
    repeated,
    repeated,
    row(s, '반복현장', '0'),
    row(s, '반복현장', '500000'),
  ]);
  expect((await commitImport(s.adminCtx, again.id)).summary?.success).toBe(0);
});
