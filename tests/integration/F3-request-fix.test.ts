import { expect, it, vi } from 'vitest';
import React, { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { callRoute } from '../helpers/routes';
import { POST } from '../../src/app/api/uses/[id]/request-fix/route';
import {
  cancelUse,
  createUse,
  getUse,
  requestFix,
  submitUse,
  updateUse,
} from '../../src/server/services/uses';
import {
  getAdminFormSettings,
  getEffectiveFormSettings,
  saveFormSettings,
} from '../../src/server/services/form-settings';
import { defaultFieldModes, type FieldKey } from '../../src/shared/form-settings';
import { Field, FormContexts } from '../../src/components/use-form/fields';
import { TripFields } from '../../src/components/use-form/trips';
import { ChargeFields } from '../../src/components/use-form/charges';
import { fromUse, newTrip } from '../../src/components/use-form/model';
import type { UseDetail } from '../../src/client/types';

vi.stubGlobal('React', React);
const database = testDatabase();

it('추가비 숨김은 지급 기본운임 보완을 막지 않으며 고객 청구는 기사 보완 대상으로 거부한다', async () => {
  const s = await setupScenario(database().db);
  const customer = await s.f.counterparty({ kind: 'CUSTOMER' });
  await s.f.rate(customer.id, { direction: 'RECEIVABLE' });
  let use = await createUse(s.adminCtx, {
    ...s.input,
    customer_counterparty_id: customer.id,
    charge_lines: [
      { direction: 'PAYABLE', charge_type: 'BASE' },
      { direction: 'RECEIVABLE', charge_type: 'BASE' },
    ],
  });
  use = await submitUse(s.adminCtx, use.id, { version: use.version });
  await saveFormSettings(s.adminCtx, {
    project_id: s.project.id,
    fields: [{ field_key: 'extra_charges', driver_mode: 'HIDDEN', manager_mode: null, version: 0 }],
  });
  const receivable = use.charge_lines.find((line) => line.direction === 'RECEIVABLE')!;
  await expect(
    requestFix(s.adminCtx, use.id, {
      version: use.version,
      fix_items: [{ target: `charge:${receivable.id}`, message: '청구 확인' }],
    }),
  ).rejects.toMatchObject({ status: 422, message: expect.stringContaining('기사가 수정할 수 없는 비용') });
  expect(await getUse(s.adminCtx, use.id)).toEqual(use);
  const payable = use.charge_lines.find((line) => line.direction === 'PAYABLE')!;
  expect(
    (
      await requestFix(s.adminCtx, use.id, {
        version: use.version,
        fix_items: [{ target: `charge:${payable.id}`, message: '청구수량 확인' }],
      })
    ).review_status,
  ).toBe('NEEDS_FIX');
});

it('기존 추가비 보완요청은 숨김·빈 목록이어도 추가 입력을 제공한다', async () => {
  const s = await setupScenario(database().db);
  const use = await createUse(s.driverCtx, s.input);
  const saved = JSON.parse(JSON.stringify(use)) as UseDetail;
  const markup = renderToStaticMarkup(
    h(FormContexts, {
      modes: { ...defaultFieldModes('driver'), extra_charges: 'HIDDEN' },
      fixes: [{ target: 'extra_charges', message: '통행료를 추가하세요' }],
      children: h(ChargeFields, {
        form: fromUse(saved, 'driver'),
        mode: 'driver',
        userId: s.driverUser.id,
        saved,
        onChange: () => {},
      }),
    }),
  );
  expect(markup).toContain('+ 추가 비용');
  expect(markup).not.toContain('관리자 설정상 숨김 항목입니다');
  expect(markup).toContain('보완 요청: 통행료를 추가하세요');
});

it.each(['requester', 'use.requester', 'trip:1.notes', 'charge', 'charges'])(
  '기사에게 숨긴 %s 보완요청은 422 사유와 함께 전체 롤백한다',
  async (target) => {
    const s = await setupScenario(database().db);
    let use = await createUse(s.driverCtx, {
      ...s.input,
      requester: '기존 요청자',
      charge_lines: [
        { charge_type: 'BASE' },
        { charge_type: 'TOLL', requested_amount: 1000, reason: '통행료' },
      ],
    });
    use = await submitUse(s.driverCtx, use.id, { version: use.version });
    await saveFormSettings(s.adminCtx, {
      project_id: s.project.id,
      fields: [{ field_key: 'extra_charges', driver_mode: 'HIDDEN', manager_mode: 'OPTIONAL', version: 0 }],
    });
    const resolvedTarget =
      target === 'charge'
        ? `charge:${use.charge_lines.find((line) => line.charge_type === 'TOLL')!.id}.reason`
        : target;
    const session = await s.f.session(s.admin.id);
    const response = await callRoute(database().db, POST, {
      token: session.token,
      method: 'POST',
      params: { id: use.id },
      body: {
        version: use.version,
        fix_items: [
          { target: 'evidence', message: '증빙 확인' },
          { target: resolvedTarget, message: '보완해 주세요' },
        ],
      },
    });
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { fields: [{ target: resolvedTarget, reason: expect.stringContaining('기사에게 숨김') }] },
    });
    expect(await getUse(s.driverCtx, use.id)).toEqual(use);
  },
);

it('현장·역할별 유효 기사 설정으로 보완 허용 여부를 결정한다', async () => {
  const s = await setupScenario(database().db);
  const manager = await s.f.user({ role: 'SITE_MANAGER' });
  await s.f.assignment(manager.id, s.project.id);
  await saveFormSettings(s.adminCtx, {
    project_id: null,
    fields: [{ field_key: 'requester', driver_mode: 'HIDDEN', manager_mode: 'OPTIONAL', version: 0 }],
  });
  await saveFormSettings(s.adminCtx, {
    project_id: s.project.id,
    fields: [{ field_key: 'requester', driver_mode: 'OPTIONAL', manager_mode: 'HIDDEN', version: 0 }],
  });
  const ctx = s.f.context(manager);
  expect(await getEffectiveFormSettings(ctx, s.project.id)).toMatchObject({
    modes: { requester: 'HIDDEN' },
    driver_modes: { requester: 'OPTIONAL' },
  });
  expect(await getEffectiveFormSettings(s.driverCtx, s.project.id)).not.toHaveProperty('driver_modes');
  let use = await createUse(s.driverCtx, s.input);
  use = await submitUse(s.driverCtx, use.id, { version: use.version });
  expect(
    (
      await requestFix(ctx, use.id, {
        version: use.version,
        fix_items: [{ target: 'requester', message: '요청자 보완' }],
      })
    ).review_status,
  ).toBe('NEEDS_FIX');
});

it('빈 숨김 항목도 미해결 보완 대상이면 표시하고 회차 상세를 펼친다', () => {
  const modes = { ...defaultFieldModes('driver'), extra_charges: 'HIDDEN' as const };
  const fixes = [
    { target: 'use.requester', message: '요청자 보완' },
    { target: 'trip:1.via', message: '경유 보완' },
    { target: 'trip:1.is_empty_return', message: '공차 확인' },
  ];
  const markup = renderToStaticMarkup(
    h(FormContexts, {
      modes,
      fixes,
      children: [
        h(
          Field,
          { key: 'requester', label: '요청자', target: 'requester' },
          h('input', { value: '', readOnly: true }),
        ),
        h(TripFields, { key: 'trips', trips: [newTrip()], recent: [], onChange: () => {} }),
      ],
    }),
  );
  for (const fix of fixes) expect(markup).toContain(`보완 요청: ${fix.message}`);
  expect(markup).not.toContain('관리자 설정상 숨김 항목입니다');
  expect(markup).toContain('<details open=""');
});

it('설정 경고는 현재 미해결 건만 집계하고 회사 상속·현장 재정의를 구분한다', async () => {
  const s = await setupScenario(database().db);
  const key: FieldKey = 'notes';
  await saveFormSettings(s.adminCtx, {
    project_id: null,
    fields: [{ field_key: key, driver_mode: 'OPTIONAL', manager_mode: null, version: 0 }],
  });
  const makeFix = async (projectId: string) => {
    let use = await createUse(s.adminCtx, { ...s.input, project_id: projectId });
    use = await submitUse(s.adminCtx, use.id, { version: use.version });
    return requestFix(s.adminCtx, use.id, {
      version: use.version,
      fix_items: [
        { target: 'notes', message: '메모 보완' },
        { target: 'use.notes', message: '추가 안내' },
      ],
    });
  };
  let active = await makeFix(s.project.id);
  const other = await s.f.project();
  await saveFormSettings(s.adminCtx, {
    project_id: other.id,
    fields: [{ field_key: key, driver_mode: 'OPTIONAL', manager_mode: null, version: 0 }],
  });
  await makeFix(other.id);
  const canceled = await makeFix(s.project.id);
  await cancelUse(s.adminCtx, canceled.id, { version: canceled.version, reason: '취소' });
  expect(await getAdminFormSettings(s.adminCtx)).toMatchObject({ pending_fixes: { notes: 1 } });
  expect(await getAdminFormSettings(s.adminCtx, s.project.id)).toMatchObject({ pending_fixes: { notes: 1 } });
  const saved = await saveFormSettings(s.adminCtx, {
    project_id: null,
    fields: [{ field_key: key, driver_mode: 'HIDDEN', manager_mode: null, version: 1 }],
  });
  expect(saved).toMatchObject({ pending_fixes: { notes: 1 }, effective: { driver: { notes: 'HIDDEN' } } });
  active = await updateUse(s.adminCtx, active.id, { version: active.version, notes: '보완 완료' });
  active = await submitUse(s.adminCtx, active.id, { version: active.version });
  expect(active.review_status).toBe('SUBMITTED');
  expect(await getAdminFormSettings(s.adminCtx, s.project.id)).toMatchObject({ pending_fixes: {} });
  expect(await getAdminFormSettings(s.adminCtx)).toMatchObject({ pending_fixes: {} });
});
