import { expect, it } from 'vitest';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { createUse, updateUse, submitUse, getUse } from '../../src/server/services/uses';
import { getEffectiveFormSettings, saveFormSettings } from '../../src/server/services/form-settings';
import { sendDraft, type Transport } from '../../src/client/offline/engine';
import { ApiError } from '../../src/client/api';
import { AppError } from '../../src/server/errors';
import { fromUse, toInput, tripQuantityPatch, validateFields } from '../../src/components/use-form/model';
import { revealDraftFields, tripRevealTarget } from '../../src/components/use-form/visibility';
import type { UseDetail } from '../../src/client/types';
import type { Draft } from '../../src/client/offline/store';

const database = testDatabase();
const json = (value: unknown): UseDetail => JSON.parse(JSON.stringify(value));

it('저장된 완료·false·빈 회차 값은 숨김 유지, 입력한 0과 true는 노출·보존한다', async () => {
  const s = await setupScenario(database().db);
  const use = json(
    await createUse(s.driverCtx, {
      ...s.input,
      trips: [
        { seq: 1, origin: '상차', destination: '하차' },
        { seq: 2, origin: '복귀', destination: '창고', quantity: '0', hours: '0', is_empty_return: true },
      ],
    }),
  );
  const { modes } = await getEffectiveFormSettings(s.driverCtx, s.project.id);
  const draft: Draft = {
    id: crypto.randomUUID(),
    userId: s.driverUser.id,
    mode: 'driver',
    form: fromUse(use, 'driver'),
    server: use,
    serverId: use.id,
    uploads: [],
    phase: 'saved',
    updatedAt: Date.now(),
  };
  const revealed = revealDraftFields(draft, modes);
  expect(revealed.revealedFields).not.toContain('operation_status');
  for (const property of ['status', 'is_empty_return', 'cargo_desc'])
    expect(revealed.revealedFields).not.toContain(tripRevealTarget(draft.form.trips[0], property));
  for (const property of ['quantity', 'hours', 'is_empty_return'])
    expect(revealed.revealedFields).toContain(tripRevealTarget(draft.form.trips[1], property));
  draft.form.trips[1].is_empty_return = false;
  const continued = revealDraftFields({ ...draft, revealedFields: revealed.revealedFields }, modes);
  expect(continued.revealedFields).toContain(tripRevealTarget(draft.form.trips[1], 'is_empty_return'));
  const saved = await updateUse(s.driverCtx, use.id, {
    ...toInput(continued.form, 'driver'),
    version: use.version,
  });
  expect(saved.trips[1]).toMatchObject({ quantity: '0.000', hours: '0.000', is_empty_return: false });
});

it('회당 자동 수량은 완료만 세며 사용자 수량·0·빈 값과 저장 수량을 덮어쓰지 않는다', async () => {
  const s = await setupScenario(database().db);
  await s.f.rate(s.payee.id, { project_id: s.project.id, billing_unit: 'PER_TRIP', unit_price: 100000 });
  const use = json(
    await createUse(s.driverCtx, {
      ...s.input,
      trips: ['COMPLETED', 'COMPLETED', 'CANCELED', 'IN_PROGRESS'].map((status, index) => ({
        seq: index + 1,
        origin: '상차',
        destination: '하차',
        status: status as 'COMPLETED' | 'CANCELED' | 'IN_PROGRESS',
      })),
      charge_lines: [{ charge_type: 'BASE', billing_unit: 'PER_TRIP', quantity: null }],
    }),
  );
  const form = fromUse(use, 'driver');
  const charge = form.charges[0];
  expect(tripQuantityPatch(charge, form.trips)).toEqual({ quantity: '2', quantitySource: 'automatic' });
  Object.assign(charge, tripQuantityPatch(charge, form.trips));
  form.trips[1].status = 'CANCELED';
  expect(tripQuantityPatch(charge, form.trips)).toEqual({ quantity: '1', quantitySource: 'automatic' });
  for (const quantity of ['7', '0', ''])
    expect(tripQuantityPatch({ ...charge, quantity, quantitySource: 'manual' }, form.trips)).toBeUndefined();
  charge.quantity = '5';
  charge.quantitySource = 'manual';
  const input = toInput(form, 'driver');
  expect(input.charge_lines?.[0]).not.toHaveProperty('quantitySource');
  const saved = json(await updateUse(s.driverCtx, use.id, { ...input, version: use.version }));
  expect(saved.charge_lines[0]).toMatchObject({ quantity: '5.000', computed_amount: 500000 });
  expect(tripQuantityPatch(fromUse(saved, 'driver').charges[0], form.trips)).toBeUndefined();
  charge.quantity = '';
  expect(validateFields(form, 'submit')).toContainEqual({
    target: `charge:${charge.id}.quantity`,
    reason: '청구 수량을 입력하세요',
  });
});

for (const kind of ['requester', 'quantity', 'evidence'] as const) {
  it(`서버 제출 오류의 입력 대상과 한국어 사유를 초안에 보존한다: ${kind}`, async () => {
    const s = await setupScenario(database().db, {
      evidence_policy: kind === 'evidence' ? 'PHOTO_OR_ALTERNATIVE' : 'NONE',
    });
    if (kind === 'requester')
      await saveFormSettings(s.adminCtx, {
        project_id: s.project.id,
        fields: [{ field_key: 'requester', driver_mode: 'REQUIRED', manager_mode: null, version: 0 }],
      });
    const use = json(
      await createUse(s.driverCtx, {
        ...s.input,
        charge_lines: [
          { charge_type: 'BASE', billing_unit: 'PER_TRIP', quantity: kind === 'quantity' ? null : '1' },
        ],
      }),
    );
    const form = fromUse(use, 'driver');
    // The initial create has returned an ID, but the local charge still has only its UI key.
    form.charges[0].id = undefined;
    const draft: Draft = {
      id: crypto.randomUUID(),
      userId: s.driverUser.id,
      mode: 'driver',
      form,
      serverId: use.id,
      server: use,
      lastSaved: use,
      version: use.version,
      uploads: [],
      phase: 'queued',
      intent: 'submit',
      savedRequest: true,
      updatedAt: Date.now(),
    };
    const io: Transport = {
      isActive: () => true,
      get: async <T>(url: string) =>
        (url === '/api/me' ? { id: s.driverUser.id } : json(await getUse(s.driverCtx, use.id))) as T,
      mutate: async () => {
        try {
          await submitUse(s.driverCtx, use.id, { version: use.version });
        } catch (error) {
          if (error instanceof AppError)
            throw new ApiError(error.status, error.code, error.message, error.details);
          throw error;
        }
        throw new Error('제출이 거부되어야 합니다');
      },
      upload: async () => {},
    };
    const saved = await sendDraft(draft, async () => {}, io);
    expect(saved.phase).toBe('editing');
    expect(saved.inputError).toBe(true);
    expect(saved.inputErrors?.[0].target).toBe(
      kind === 'quantity' ? `charge:${use.charge_lines[0].id}.quantity` : kind,
    );
    expect(saved.form.charges[0].id).toBe(use.charge_lines[0].id);
    if (kind === 'evidence')
      expect(saved.inputErrors?.[0].reason).toBe(
        '사진·인수증·계근표·확인서 중 1개 이상 또는 전표번호를 등록하세요.',
      );
    expect((await getUse(s.driverCtx, use.id)).review_status).toBe('DRAFT');
  });
}
