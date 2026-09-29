import { beforeEach, expect, it, vi } from 'vitest';
import { eq, isNull } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import React, { createElement } from 'react';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { callRoute } from '../helpers/routes';
import { formFieldSettings, auditLogs, projects, projectAssignments } from '../../src/server/db/schema';
import { approveUse, createUse, getUse, submitUse, updateUse } from '../../src/server/services/uses';
import {
  getAdminFormSettings,
  getEffectiveFormSettings,
  saveFormSettings,
} from '../../src/server/services/form-settings';
import { GET, PUT } from '../../src/app/api/admin/form-fields/route';
import { GET as effectiveGET } from '../../src/app/api/form-settings/route';
import {
  defaultFieldModes,
  fieldKeys,
  requiredFieldErrors,
  type FieldKey,
  type FieldMode,
} from '../../src/shared/form-settings';
import { auditChanges, auditLabel, auditValue } from '../../src/components/manager/audit';
import { Field, SettingsContext } from '../../src/components/use-form/fields';
import { fromUse, validate } from '../../src/components/use-form/model';
import type { UseDetail } from '../../src/client/types';

vi.stubGlobal('React', React);
const database = testDatabase();
beforeEach(async () => {
  await database().db.delete(formFieldSettings);
});
const field = (
  field_key: FieldKey,
  driver_mode: FieldMode | null,
  manager_mode: FieldMode | null = null,
  version = 0,
) => ({ field_key, driver_mode, manager_mode, version });

it('코드 기본값은 최소 기사 폼, 담당자는 모두 선택이며 요청자 없는 기사 제출 성공', async () => {
  const s = await setupScenario(database().db);
  const settings = await getEffectiveFormSettings(s.driverCtx, s.project.id);
  expect(settings.modes).toEqual(defaultFieldModes('driver'));
  expect(
    Object.values((await getEffectiveFormSettings(s.adminCtx, s.project.id)).modes).every(
      (mode) => mode === 'OPTIONAL',
    ),
  ).toBe(true);
  const use = await createUse(s.driverCtx, s.input);
  expect((await submitUse(s.driverCtx, use.id, { version: use.version })).review_status).toBe('SUBMITTED');
  expect(await database().db.select().from(formFieldSettings)).toHaveLength(0);
});

it('요청자 필수 설정은 DRAFT 저장 허용, 서버·클라이언트 제출 차단, 값 입력 후 제출', async () => {
  const s = await setupScenario(database().db);
  await saveFormSettings(s.adminCtx, { project_id: null, fields: [field('requester', 'REQUIRED')] });
  let use = await createUse(s.driverCtx, { ...s.input, requester: '  ' });
  expect(use.review_status).toBe('DRAFT');
  const modes = (await getEffectiveFormSettings(s.driverCtx, s.project.id)).modes;
  const form = fromUse(JSON.parse(JSON.stringify(use)) as UseDetail, 'driver');
  expect(validate(form, 'save', modes)).toEqual([]);
  expect(validate(form, 'submit', modes)).toContain('요청자 항목을 입력하세요.');
  await expect(submitUse(s.driverCtx, use.id, { version: use.version })).rejects.toMatchObject({
    code: 'SUBMIT_BLOCKED',
    details: { fields: [{ target: 'requester', reason: '요청자 항목을 입력하세요.' }] },
  });
  expect((await getUse(s.driverCtx, use.id)).version).toBe(use.version);
  use = await updateUse(s.driverCtx, use.id, { version: use.version, requester: '홍담당' });
  expect((await submitUse(s.driverCtx, use.id, { version: use.version })).review_status).toBe('SUBMITTED');
});

it('현장 A만 항목·역할별 재정의, B는 회사 기본, 해제 후 최신 회사 기본을 다시 따름', async () => {
  const s = await setupScenario(database().db);
  const b = await s.f.project();
  await s.f.assignment(s.driverUser.id, b.id);
  await saveFormSettings(s.adminCtx, {
    project_id: null,
    fields: [field('requester', 'REQUIRED', 'HIDDEN'), field('notes', 'OPTIONAL')],
  });
  await saveFormSettings(s.adminCtx, {
    project_id: s.project.id,
    fields: [field('requester', 'HIDDEN', 'REQUIRED')],
  });
  expect((await getEffectiveFormSettings(s.driverCtx, s.project.id)).modes).toMatchObject({
    requester: 'HIDDEN',
    notes: 'OPTIONAL',
  });
  expect((await getEffectiveFormSettings(s.driverCtx, b.id)).modes.requester).toBe('REQUIRED');
  const proxy = await createUse(s.adminCtx, s.input);
  await expect(submitUse(s.adminCtx, proxy.id, { version: proxy.version })).rejects.toThrow('요청자');
  const driver = await createUse(s.driverCtx, s.input);
  await submitUse(s.driverCtx, driver.id, { version: driver.version });
  await saveFormSettings(s.adminCtx, {
    project_id: s.project.id,
    fields: [field('requester', null, null, 1)],
  });
  await saveFormSettings(s.adminCtx, {
    project_id: null,
    fields: [field('requester', 'OPTIONAL', 'HIDDEN', 1)],
  });
  expect((await getEffectiveFormSettings(s.driverCtx, s.project.id)).modes.requester).toBe('OPTIONAL');
  expect(
    (await getAdminFormSettings(s.adminCtx, s.project.id)).fields.find(
      (row) => row.field_key === 'requester',
    ),
  ).toMatchObject({ version: 2, driver_mode: null, manager_mode: null });
  await expect(
    saveFormSettings(s.adminCtx, { project_id: s.project.id, fields: [field('requester', 'REQUIRED')] }),
  ).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
});

it('첫 저장 동시성·회사 NULL 유니크·버전 충돌 409와 다중 항목 롤백', async () => {
  const s = await setupScenario(database().db);
  const input = { project_id: null, fields: [field('requester', 'REQUIRED')] };
  const outcomes = await Promise.allSettled([
    saveFormSettings(s.adminCtx, input),
    saveFormSettings(s.adminCtx, input),
  ]);
  expect(outcomes.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.find((value) => value.status === 'rejected')).toMatchObject({
    reason: { code: 'VERSION_CONFLICT', status: 409 },
  });
  expect(
    await database().db.select().from(formFieldSettings).where(isNull(formFieldSettings.project_id)),
  ).toHaveLength(1);
  const session = await s.f.session(s.admin.id);
  const response = await callRoute(database().db, PUT, {
    token: session.token,
    method: 'PUT',
    body: { project_id: null, fields: [field('notes', 'REQUIRED'), field('requester', 'HIDDEN')] },
  });
  expect(response.status).toBe(409);
  const conflict = (await response.json()).error.details.current;
  expect(conflict.effective.driver).toMatchObject({ requester: 'REQUIRED', notes: 'HIDDEN' });
  expect(conflict.fields.find((row: { field_key: string }) => row.field_key === 'notes').version).toBe(0);
  expect((await getAdminFormSettings(s.adminCtx)).effective.driver.notes).toBe('HIDDEN');
});

it('기사·현장담당자의 설정 변경/관리 조회 403, 유효 설정은 배정 범위만, 권한 회수 즉시 반영', async () => {
  const s = await setupScenario(database().db);
  const manager = await s.f.user({ role: 'SITE_MANAGER' });
  await s.f.assignment(manager.id, s.project.id);
  for (const user of [s.driverUser, manager]) {
    const session = await s.f.session(user.id);
    for (const [handler, method] of [
      [PUT, 'PUT'],
      [GET, 'GET'],
    ] as const) {
      const response = await callRoute(database().db, handler, {
        token: session.token,
        method,
        ...(method === 'PUT' ? { body: { project_id: null, fields: [field('notes', 'REQUIRED')] } } : {}),
      });
      expect(response.status).toBe(403);
    }
    await expect(
      saveFormSettings(s.f.context(user), { project_id: null, fields: [field('notes', 'REQUIRED')] }),
    ).rejects.toMatchObject({ status: 403 });
  }
  const session = await s.f.session(s.driverUser.id);
  const other = await s.f.project();
  expect(
    (
      await callRoute(database().db, effectiveGET, {
        token: session.token,
        path: `/api/form-settings?project_id=${other.id}`,
      })
    ).status,
  ).toBe(404);
  const settings = await callRoute(database().db, effectiveGET, {
    token: session.token,
    path: `/api/form-settings?project_id=${s.project.id}`,
  });
  expect((await settings.json()).data).toEqual({
    project_id: s.project.id,
    modes: defaultFieldModes('driver'),
  });
  await database()
    .db.update(projectAssignments)
    .set({ revoked_at: new Date() })
    .where(eq(projectAssignments.id, s.assignment.id));
  await expect(getEffectiveFormSettings(s.driverCtx, s.project.id)).rejects.toMatchObject({ status: 404 });
});

it('설정 저장·해제 감사로그와 한국어 변경 표시, API 멱등 재시도', async () => {
  const s = await setupScenario(database().db);
  const session = await s.f.session(s.admin.id);
  const options = {
    token: session.token,
    method: 'PUT',
    path: '/api/admin/form-fields',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: { project_id: s.project.id, fields: [field('requester', 'REQUIRED')] },
  };
  expect((await callRoute(database().db, PUT, options)).status).toBe(200);
  expect((await callRoute(database().db, PUT, options)).headers.get('idempotency-replayed')).toBe('true');
  await saveFormSettings(s.adminCtx, {
    project_id: s.project.id,
    fields: [field('requester', null, null, 1)],
  });
  const rows = await database().db.select().from(auditLogs).where(eq(auditLogs.user_id, s.admin.id));
  const logs = rows.filter((row) => row.action === 'FORM_FIELDS_UPDATE');
  expect(logs).toHaveLength(2);
  expect(logs.find((row) => row.before === null)?.after).toMatchObject({
    field_key: 'requester',
    driver_mode: 'REQUIRED',
    updated_by: s.admin.id,
  });
  expect(auditLabel('FORM_FIELDS_UPDATE')).toBe('입력 항목 설정 변경');
  expect(auditValue('requester', 'field_key')).toBe('요청자');
  expect(auditChanges({ driver_mode: 'REQUIRED' }, { driver_mode: null })[0].title).toBe('기사 입력');
});

it('모든 필수 항목·각 회차 검사, false/0 유효, 숨긴 기존 값 저장 보존, 고정 필수 운행', async () => {
  const s = await setupScenario(database().db);
  await saveFormSettings(s.adminCtx, {
    project_id: s.project.id,
    fields: fieldKeys.map((key) => field(key, 'REQUIRED')),
  });
  const use = await createUse(s.driverCtx, {
    ...s.input,
    trips: [
      { seq: 1, origin: '상차', destination: '하차' },
      { seq: 2, origin: '상차', destination: '하차' },
    ],
  });
  const modes = (await getEffectiveFormSettings(s.driverCtx, s.project.id)).modes;
  const errors = requiredFieldErrors(use, modes);
  expect(errors.map((row) => row.target)).toEqual(
    expect.arrayContaining([
      'end_date',
      'work_type_id',
      'requester',
      'cargo_desc',
      'notes',
      'trip:1.via',
      'trip:2.quantity',
      'trip:2.quantity_unit',
      'trip:2.hours',
      'trip:2.depart_at',
      'trip:2.arrive_at',
      'trip:2.cargo_desc',
      'trip:2.notes',
      'charges',
    ]),
  );
  expect(errors.some((row) => row.target.endsWith('is_empty_return'))).toBe(false);
  await expect(submitUse(s.driverCtx, use.id, { version: use.version })).rejects.toMatchObject({
    code: 'SUBMIT_BLOCKED',
  });
  await saveFormSettings(s.adminCtx, {
    project_id: s.project.id,
    fields: fieldKeys.map((key) => field(key, 'HIDDEN', null, 1)),
  });
  let hidden = await updateUse(s.driverCtx, use.id, {
    version: use.version,
    requester: '가져온 요청자',
    notes: '기존 메모',
  });
  hidden = await submitUse(s.driverCtx, hidden.id, { version: hidden.version });
  expect(hidden).toMatchObject({ requester: '가져온 요청자', notes: '기존 메모' });
  const empty = await createUse(s.driverCtx, { ...s.input, trips: [] });
  await expect(submitUse(s.driverCtx, empty.id, { version: empty.version })).rejects.toThrow('1건 이상');
  const whitespace = await createUse(s.driverCtx, {
    ...s.input,
    trips: [{ seq: 1, origin: ' ', destination: ' ' }],
  });
  await expect(submitUse(s.driverCtx, whitespace.id, { version: whitespace.version })).rejects.toThrow(
    '출발·도착',
  );
  await database()
    .db.update(projects)
    .set({ evidence_policy: 'PHOTO_REQUIRED' })
    .where(eq(projects.id, s.project.id));
  const missingEvidence = await createUse(s.driverCtx, s.input);
  await expect(
    submitUse(s.driverCtx, missingEvidence.id, { version: missingEvidence.version }),
  ).rejects.toThrow('증빙');
});

it('설정 불가 키·중복 키·잘못된 모드는 거부, 숨김은 마크업에서 제외·필수 접근성 표시', async () => {
  const s = await setupScenario(database().db);
  for (const fields of [
    [field('requester', 'OPTIONAL'), field('requester', 'REQUIRED')],
    [{ ...field('requester', 'OPTIONAL'), field_key: 'project_id' }],
    [{ ...field('requester', 'OPTIONAL'), driver_mode: 'INVALID' }],
  ])
    await expect(saveFormSettings(s.adminCtx, { project_id: null, fields })).rejects.toThrow();
  const markup = (mode: FieldMode) =>
    renderToStaticMarkup(
      createElement(
        SettingsContext.Provider,
        { value: { ...defaultFieldModes('driver'), requester: mode } },
        createElement(Field, { label: '요청자', target: 'requester' }, createElement('input')),
      ),
    );
  expect(markup('HIDDEN')).toBe('');
  expect(markup('REQUIRED')).toContain('aria-required="true"');
  expect(markup('REQUIRED')).toContain('필수');
});

it('필수값 완성은 0·공차 아님·추가비 0원도 허용하고 운행별 필수 정책은 공통 검사한다', async () => {
  const s = await setupScenario(database().db);
  const work = await s.f.workType();
  await saveFormSettings(s.adminCtx, {
    project_id: s.project.id,
    fields: fieldKeys.map((key) => field(key, 'REQUIRED')),
  });
  const use = await createUse(s.driverCtx, {
    ...s.input,
    end_date: '2026-09-15',
    work_type_id: work.id,
    requester: '담당',
    cargo_desc: '자재',
    notes: '확인',
    trips: [
      {
        seq: 1,
        origin: '창고',
        destination: '현장',
        via: ['경유지'],
        cargo_desc: '자재',
        quantity: '0',
        quantity_unit: '톤',
        hours: '0',
        depart_at: '2026-09-15T09:00:00+09:00',
        arrive_at: '2026-09-15T10:00:00+09:00',
        is_empty_return: false,
        notes: '완료',
      },
    ],
    charge_lines: [
      { direction: 'PAYABLE', charge_type: 'BASE', billing_unit: 'PER_DAY' },
      {
        direction: 'PAYABLE',
        charge_type: 'TOLL',
        requested_amount: 0,
        reason: '기본 포함',
        included_in_base: true,
      },
    ],
  });
  const modes = (await getEffectiveFormSettings(s.driverCtx, s.project.id)).modes;
  const form = fromUse(JSON.parse(JSON.stringify(use)) as UseDetail, 'driver');
  expect(validate(form, 'submit', modes)).toEqual([]);
  form.trips[0].via = ' , ';
  expect(validate(form, 'submit', modes)).toContain('1회차 경유 항목을 입력하세요.');
  expect((await submitUse(s.driverCtx, use.id, { version: use.version })).review_status).toBe('SUBMITTED');
});

it('담당자의 승인 후 자동 재제출도 필수 설정을 검사하고 실패하면 기존 승인을 보존', async () => {
  const s = await setupScenario(database().db);
  let use = await createUse(s.adminCtx, s.input);
  use = await submitUse(s.adminCtx, use.id, { version: use.version });
  use = await approveUse(s.adminCtx, use.id, { version: use.version });
  await saveFormSettings(s.adminCtx, {
    project_id: s.project.id,
    fields: [field('requester', 'HIDDEN', 'REQUIRED')],
  });
  await expect(updateUse(s.adminCtx, use.id, { version: use.version, notes: '변경' })).rejects.toMatchObject({
    code: 'SUBMIT_BLOCKED',
  });
  expect((await getUse(s.adminCtx, use.id)).review_status).toBe('APPROVED');
  const updated = await updateUse(s.adminCtx, use.id, { version: use.version, requester: '담당' });
  expect(updated.review_status).toBe('SUBMITTED');
});
