import { expect, it, vi } from 'vitest';
import React, { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { createUse, submitUse, updateUse } from '../../src/server/services/uses';
import { getEffectiveFormSettings, saveFormSettings } from '../../src/server/services/form-settings';
import { fieldKeys } from '../../src/shared/form-settings';
import { Field, FormContexts } from '../../src/components/use-form/fields';
import { ChargeFields } from '../../src/components/use-form/charges';
import { TripFields } from '../../src/components/use-form/trips';
import { fromUse, newCharge, toInput, validate } from '../../src/components/use-form/model';
import type { UseDetail } from '../../src/client/types';

vi.stubGlobal('React', React);
const database = testDatabase();
const json = (value: unknown): UseDetail => JSON.parse(JSON.stringify(value));

it('숨김으로 변경해도 미완성 추가비 행은 편집·삭제 가능하며 기존 검증을 유지한다', async () => {
  const s = await setupScenario(database().db);
  const use = await createUse(s.driverCtx, s.input);
  const form = fromUse(json(use), 'driver');
  form.charges.push({ ...newCharge('PAYABLE', false), requested_amount: '1200' });
  await saveFormSettings(s.adminCtx, {
    project_id: s.project.id,
    fields: [{ field_key: 'extra_charges', driver_mode: 'HIDDEN', manager_mode: 'HIDDEN', version: 0 }],
  });
  const { modes } = await getEffectiveFormSettings(s.driverCtx, s.project.id);
  for (const mode of ['driver', 'manager'] as const) {
    const markup = renderToStaticMarkup(
      h(FormContexts, {
        modes,
        fixes: [],
        children: h(ChargeFields, {
          form,
          mode,
          userId: s.driverUser.id,
          onChange: () => {},
          saved: json(use),
        }),
      }),
    );
    expect(markup).toContain('추가비 1 요청액');
    expect(markup).toContain('추가 비용 삭제');
    expect(markup).not.toContain('관리자 설정상 숨김 항목입니다');
    expect(markup).not.toContain('+ 추가 비용');
  }
  expect(validate(form, 'save', modes)).toContain('추가 비용은 정수 원 요청액과 사유를 입력하세요.');
  expect(validate(form, 'submit', modes)).toContain('추가 비용은 정수 원 요청액과 사유를 입력하세요.');
  form.charges[1].reason = '통행료';
  expect(validate(form, 'submit', modes)).toEqual([]);
  let saved = await updateUse(s.driverCtx, use.id, { ...toInput(form, 'driver'), version: use.version });
  expect(saved.charge_lines.find((line) => line.charge_type === 'TOLL')).toMatchObject({
    requested_amount: 1200,
    reason: '통행료',
  });
  const edited = fromUse(json(saved), 'driver');
  edited.charges = edited.charges.filter((line) => line.charge_type === 'BASE');
  saved = await updateUse(s.driverCtx, saved.id, { ...toInput(edited, 'driver'), version: saved.version });
  expect(saved.charge_lines).toHaveLength(1);
  expect((await submitUse(s.driverCtx, saved.id, { version: saved.version })).review_status).toBe(
    'SUBMITTED',
  );
});

it('숨긴 헤더·회차의 기존 값과 0은 표시하고 기본 false는 숨기되 서버에 보존한다', async () => {
  const s = await setupScenario(database().db);
  const use = await createUse(s.driverCtx, {
    ...s.input,
    requester: '기존 요청자',
    notes: '기존 메모',
    trips: [
      {
        seq: 1,
        origin: '창고',
        destination: '현장',
        via: ['경유지'],
        quantity: '0',
        hours: '0',
        is_empty_return: false,
        notes: '회차 메모',
      },
    ],
  });
  await saveFormSettings(s.adminCtx, {
    project_id: s.project.id,
    fields: fieldKeys.map((field_key) => ({
      field_key,
      driver_mode: 'HIDDEN',
      manager_mode: 'HIDDEN',
      version: 0,
    })),
  });
  const { modes } = await getEffectiveFormSettings(s.driverCtx, s.project.id);
  const form = fromUse(json(use), 'driver');
  for (const target of ['requester', 'notes'] as const) {
    const markup = renderToStaticMarkup(
      h(FormContexts, {
        modes,
        fixes: [],
        children: h(Field, { target, label: target }, h('input', { value: form[target], readOnly: true })),
      }),
    );
    expect(markup).toContain(form[target]);
    expect(markup).not.toContain('관리자 설정상 숨김 항목입니다');
  }
  const markup = renderToStaticMarkup(
    h(FormContexts, {
      modes,
      fixes: [],
      children: h(TripFields, { trips: form.trips, recent: [], onChange: () => {} }),
    }),
  );
  for (const label of ['상세 입력', '경유', '수량', '시간', '비고']) expect(markup).toContain(label);
  expect(markup).not.toContain('공차회차');
  expect(markup).toContain('경유지');
  expect(markup).toContain('value="0"');
  expect(markup).toContain('<details open=""');
  const saved = await updateUse(s.driverCtx, use.id, { ...toInput(form, 'driver'), version: use.version });
  expect(saved).toMatchObject({ requester: use.requester, notes: use.notes });
  expect(saved.trips[0]).toMatchObject({
    via: ['경유지'],
    quantity: '0.000',
    hours: '0.000',
    is_empty_return: false,
  });
});
