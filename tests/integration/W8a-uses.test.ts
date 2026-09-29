import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import {
  approveUse,
  cancelUse,
  createUse,
  getUse,
  submitUse,
  updateUse,
} from '../../src/server/services/uses';
import { chargeLines, rateAgreements } from '../../src/server/db/schema';
import { createStatement, confirmStatement } from '../../src/server/services/statements';
import { ApiError } from '../../src/client/api';
import { sendDraft, type Transport } from '../../src/client/offline/engine';
import { isUnsent, type Draft } from '../../src/client/offline/store';
import { copyValues, fromUse, validate } from '../../src/components/use-form/model';
import { evidenceError } from '../../src/components/use-form/evidence-policy';
import type { UseDetail } from '../../src/client/types';

const database = testDatabase();
const json = (value: unknown): UseDetail => JSON.parse(JSON.stringify(value));

it.each(['PER_TRIP', 'PER_HOUR', 'PER_TON', 'PER_M3'] as const)(
  '%s BASE 수량 누락은 서버 제출 거부, 수량 입력 후 제출',
  async (billing_unit) => {
    const s = await setupScenario(database().db);
    await database().db.update(rateAgreements).set({ billing_unit }).where(eq(rateAgreements.id, s.rate.id));
    let use = await createUse(s.driverCtx, { ...s.input, billing_unit });
    expect(use.charge_lines[0].quantity).toBeNull();
    const form = fromUse(json(use), 'driver');
    expect(validate(form, 'save')).not.toContain('청구 수량을 입력하세요');
    expect(validate(form, 'submit')).toContain('청구 수량을 입력하세요');
    await expect(submitUse(s.driverCtx, use.id, { version: use.version })).rejects.toMatchObject({
      code: 'SUBMIT_BLOCKED',
      message: '청구 수량을 입력하세요',
    });
    expect((await getUse(s.driverCtx, use.id)).review_status).toBe('DRAFT');
    use = await updateUse(s.driverCtx, use.id, {
      version: use.version,
      charge_lines: [
        {
          id: use.charge_lines[0].id,
          charge_type: 'BASE',
          direction: 'PAYABLE',
          billing_unit,
          quantity: '2.5',
        },
      ],
    });
    expect((await submitUse(s.driverCtx, use.id, { version: use.version })).review_status).toBe('SUBMITTED');
  },
);

it('승인 후 기사 수정은 승인 해제, 확정 후 수정·제출·취소는 기사용 안내와 함께 거부', async () => {
  const s = await setupScenario(database().db);
  let use = await createUse(s.driverCtx, s.input);
  use = await submitUse(s.driverCtx, use.id, { version: use.version });
  use = await approveUse(s.adminCtx, use.id, { version: use.version });
  use = await updateUse(s.driverCtx, use.id, { version: use.version, notes: '수정' });
  expect(use.review_status).toBe('DRAFT');
  expect(use.approved_revision_id).toBeNull();
  use = await submitUse(s.driverCtx, use.id, { version: use.version });
  use = await approveUse(s.adminCtx, use.id, { version: use.version });
  let statement = await createStatement(s.adminCtx, {
    client_request_id: crypto.randomUUID(),
    direction: 'PAYABLE',
    counterparty_id: s.payee.id,
    period_start: '2026-09-01',
    period_end: '2026-09-30',
    items: [{ charge_line_id: use.charge_lines[0].id }],
  });
  statement = await confirmStatement(s.adminCtx, statement.id, { version: statement.version });
  expect((await getUse(s.driverCtx, use.id)).is_locked).toBe(true);
  const expected = {
    code: 'STATEMENT_LOCKED',
    message: '정산 확정된 운행입니다. 수정이 필요하면 담당자에게 문의하세요',
  };
  await expect(updateUse(s.driverCtx, use.id, { version: use.version, notes: '금지' })).rejects.toMatchObject(
    expected,
  );
  await expect(submitUse(s.driverCtx, use.id, { version: use.version })).rejects.toMatchObject(expected);
  await expect(
    cancelUse(s.driverCtx, use.id, { version: use.version, reason: '금지' }),
  ).rejects.toMatchObject(expected);
  expect(statement.status).toBe('CONFIRMED');
});

it('고객 청구가 잠긴 운행도 기사에게 금액 노출 없이 잠금 여부를 제공', async () => {
  const s = await setupScenario(database().db);
  const customer = await s.f.counterparty({ kind: 'CUSTOMER' });
  await s.f.rate(customer.id, { direction: 'RECEIVABLE' });
  let use = await createUse(s.adminCtx, { ...s.input, customer_counterparty_id: customer.id });
  use = await submitUse(s.adminCtx, use.id, { version: use.version });
  use = await approveUse(s.adminCtx, use.id, { version: use.version });
  const line = use.charge_lines.find((line) => line.direction === 'RECEIVABLE')!;
  const statement = await createStatement(s.adminCtx, {
    client_request_id: crypto.randomUUID(),
    direction: 'RECEIVABLE',
    counterparty_id: customer.id,
    period_start: '2026-09-01',
    period_end: '2026-09-30',
    items: [{ charge_line_id: line.id }],
  });
  await confirmStatement(s.adminCtx, statement.id, { version: statement.version });
  const driver = await getUse(s.driverCtx, use.id);
  expect(driver.is_locked).toBe(true);
  expect(driver.charge_lines.every((line) => line.direction === 'PAYABLE')).toBe(true);
});

it('서버 작성중 운행은 본인만 취소할 수 있고 제출할 수 없는 취소 이력을 보존', async () => {
  const s = await setupScenario(database().db);
  const other = await setupScenario(database().db);
  const use = await createUse(s.driverCtx, s.input);
  await expect(
    cancelUse(other.driverCtx, use.id, { version: use.version, reason: '다른 기사' }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  const canceled = await cancelUse(s.driverCtx, use.id, { version: use.version, reason: '작성 취소' });
  expect(canceled.operation_status).toBe('CANCELED');
  await expect(submitUse(s.driverCtx, use.id, { version: canceled.version })).rejects.toThrow(
    '취소된 사용 건',
  );
});

it('복사 값은 오늘 날짜·새 행 ID만 사용하고 증빙·승인·정산 연결을 제외', async () => {
  const s = await setupScenario(database().db);
  const use = await createUse(s.driverCtx, {
    ...s.input,
    trips: [{ seq: 1, origin: '상차', destination: '하차', cargo_desc: '자재' }],
  });
  const copied = copyValues(json(use), 'driver');
  expect(copied.use_date).toBe(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()),
  );
  expect(copied.trips[0]).toMatchObject({
    origin: '상차',
    destination: '하차',
    cargo_desc: '자재',
    id: undefined,
  });
  expect(copied.charges[0].id).toBeUndefined();
  expect(copied.charges[0].trip_id).toBeUndefined();
  expect(copied).not.toHaveProperty('evidence');
  expect(JSON.stringify(copied)).not.toContain('approved');
  expect(JSON.stringify(copied)).not.toContain('locked_statement');
});

it('SUBMIT_BLOCKED는 대기열에서 제외하고 입력 오류로 복귀하며 자동 재전송하지 않는다', async () => {
  const s = await setupScenario(database().db, { evidence_policy: 'PHOTO_REQUIRED' });
  const use = json(await createUse(s.driverCtx, s.input));
  const draft: Draft = {
    id: crypto.randomUUID(),
    userId: s.driverUser.id,
    mode: 'driver',
    serverId: use.id,
    server: use,
    version: use.version,
    form: fromUse(use, 'driver'),
    uploads: [],
    phase: 'queued',
    intent: 'submit',
    savedRequest: true,
    updatedAt: Date.now(),
  };
  let calls = 0;
  const io: Transport = {
    isActive: () => true,
    get: async <T>(url: string) =>
      (url === '/api/me' ? { id: s.driverUser.id } : json(await getUse(s.driverCtx, use.id))) as T,
    mutate: async () => {
      calls++;
      try {
        await submitUse(s.driverCtx, use.id, { version: use.version });
      } catch (e) {
        throw new ApiError(422, 'SUBMIT_BLOCKED', (e as Error).message);
      }
      throw new Error('제출이 거부되어야 합니다');
    },
    upload: async () => {},
  };
  const saved = await sendDraft(draft, async () => {}, io);
  expect(saved.phase).toBe('editing');
  expect(saved.inputError).toBe(true);
  expect(isUnsent(saved)).toBe(false);
  expect(saved.request).toBeUndefined();
  await sendDraft(saved, async () => {}, io);
  expect(calls).toBe(1);
  expect((await getUse(s.driverCtx, use.id)).review_status).toBe('DRAFT');
});

it('클라이언트 증빙 정책은 파일·대체증빙·교체 예정 파일을 구분한다', async () => {
  const s = await setupScenario(database().db);
  const use = json(await createUse(s.driverCtx, s.input));
  expect(evidenceError('NONE', use.evidence, [])).toBe('');
  expect(evidenceError('PHOTO_REQUIRED', [], [])).toContain('사진 또는 인수증');
  const slip = {
    client_upload_id: 'slip',
    kind: 'SLIP_NO' as const,
    text_value: '123',
    status: 'pending' as const,
    progress: 0,
  };
  expect(evidenceError('PHOTO_REQUIRED', [], [slip])).toContain('사진 또는 인수증');
  expect(evidenceError('PHOTO_OR_ALTERNATIVE', [], [slip])).toBe('');
  expect(evidenceError('PHOTO_REQUIRED', [], [{ ...slip, kind: 'PHOTO', blob: new Blob(['image']) }])).toBe(
    '',
  );
  expect(
    (await database().db.select().from(chargeLines).where(eq(chargeLines.vehicle_use_id, use.id))).length,
  ).toBe(1);
});
