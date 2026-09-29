import { afterAll, beforeAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { callRoute } from '../helpers/routes';
import { ApiError } from '../../src/client/api';
import { sendDraft, type Transport } from '../../src/client/offline/engine';
import type { Draft } from '../../src/client/offline/store';
import { initialValues, toInput } from '../../src/components/use-form/model';
import { getLookups } from '../../src/server/services/lookups';
import {
  createUse,
  getUse,
  requestFix,
  submitUse,
  updateUse,
  confirmByDriver,
} from '../../src/server/services/uses';
import { vehicleUses, evidence, projectAssignments } from '../../src/server/db/schema';
import { GET as me } from '../../src/app/api/me/route';
import { POST as create } from '../../src/app/api/uses/route';
import { GET as get, PATCH as patch } from '../../src/app/api/uses/[id]/route';
import { POST as metadata } from '../../src/app/api/uses/[id]/evidence/route';
import { POST as submit } from '../../src/app/api/uses/[id]/submit/route';
import { PUT as content } from '../../src/app/api/evidence/[id]/content/route';
import type { RouteHandler } from '../../src/server/http';
const database = testDatabase();
let storage: string;
let oldStorage: string | undefined;
beforeAll(async () => {
  oldStorage = process.env.STORAGE_DIR;
  storage = await mkdtemp(path.join(tmpdir(), 'w2-uploads-'));
  process.env.STORAGE_DIR = storage;
});
afterAll(async () => {
  if (oldStorage === undefined) delete process.env.STORAGE_DIR;
  else process.env.STORAGE_DIR = oldStorage;
  await rm(storage, { recursive: true, force: true });
});
async function harness(options: { photo?: boolean } = {}) {
  const s = await setupScenario(database().db, {
    evidence_policy: options.photo ? 'PHOTO_REQUIRED' : 'NONE',
  });
  const token = (await s.f.session(s.driverUser.id)).token;
  const form = initialValues(JSON.parse(JSON.stringify(await getLookups(s.driverCtx))));
  form.use_date = s.input.use_date;
  form.trips = Array.from({ length: 5 }, (_, i) => ({
    ...form.trips[0],
    seq: i + 1,
    origin: '상차장',
    destination: '현장',
    client_row_id: crypto.randomUUID(),
  }));
  form.charges[0].billing_unit = 'PER_DAY';
  form.charges[0].quantity = '1';
  const draft: Draft = {
    id: crypto.randomUUID(),
    userId: s.driverUser.id,
    mode: 'driver',
    form,
    uploads: [],
    phase: 'queued',
    intent: 'submit',
    updatedAt: Date.now(),
  };
  draft.request = {
    key: crypto.randomUUID(),
    payload: { ...toInput(form, 'driver'), client_request_id: draft.id },
  };
  const calls: string[] = [];
  let failUpload = false;
  let loseResponse = false;
  let liveToken = token;
  const invoke = async <T>(
    url: string,
    method = 'GET',
    body?: unknown,
    key?: string,
    raw?: Blob,
  ): Promise<T> => {
    calls.push(`${method} ${url}`);
    const id = url.split('/')[3];
    let handler: RouteHandler;
    if (url === '/api/me') handler = me;
    else if (url === '/api/uses') handler = create;
    else if (url.endsWith('/evidence')) handler = metadata;
    else if (url.endsWith('/submit')) handler = submit;
    else if (url.endsWith('/content')) handler = content;
    else handler = method === 'PATCH' ? patch : get;
    if (raw && failUpload) throw new ApiError(503, 'UPLOAD_FAILED', '강제 업로드 실패');
    const response = await callRoute(database().db, handler, {
      path: url,
      params: { id },
      method,
      token: liveToken,
      body,
      rawBody: raw ? new Uint8Array(await raw.arrayBuffer()) : undefined,
      headers: { ...(key ? { 'idempotency-key': key } : {}), ...(raw ? { 'content-type': raw.type } : {}) },
    });
    const result = await response.json();
    if (!response.ok)
      throw new ApiError(response.status, result.error.code, result.error.message, result.error.details);
    if (loseResponse && url === '/api/uses') {
      loseResponse = false;
      throw new Error('응답 유실');
    }
    return result.data;
  };
  const io: Transport = {
    get: (url) => invoke(url),
    mutate: (url, body, key, method) => invoke(url, method ?? 'POST', body, key),
    upload: async (url, blob) => {
      await invoke(url, 'PUT', undefined, undefined, blob);
    },
    isActive: (id) => id === draft.userId,
  };
  let stored = structuredClone(draft);
  const persist = async (value: Draft) => {
    stored = structuredClone(value);
  };
  return {
    s,
    draft,
    io,
    calls,
    persist,
    stored: () => stored,
    fail: (v: boolean) => {
      failUpload = v;
    },
    lose: () => {
      loseResponse = true;
    },
    token: (v: string) => {
      liveToken = v;
    },
  };
}
it('사진 실패 후 재실행해 사진만 재전송하고 일대 30만원·운행 5건·증빙 1개로 제출한다', async () => {
  const h = await harness({ photo: true });
  h.draft.uploads = [
    {
      client_upload_id: crypto.randomUUID(),
      kind: 'PHOTO',
      original_name: '운행.jpg',
      blob: new Blob([new Uint8Array([255, 216, 255, 0, 0, 0])], { type: 'image/jpeg' }),
      status: 'pending',
      progress: 0,
    },
  ];
  h.fail(true);
  await sendDraft(h.draft, h.persist, h.io);
  const partial = h.stored();
  expect(partial).toMatchObject({ phase: 'queued', savedRequest: true });
  expect(partial.uploads[0].status).toBe('failed');
  expect((await getUse(h.s.driverCtx, partial.serverId!)).review_status).toBe('DRAFT');
  h.fail(false);
  await sendDraft(structuredClone(partial), h.persist, h.io);
  expect(h.stored().phase).toBe('saved');
  const use = await getUse(h.s.driverCtx, partial.serverId!);
  expect(use.review_status).toBe('SUBMITTED');
  expect(use.trips).toHaveLength(5);
  expect(use.charge_lines[0].computed_amount).toBe(300000);
  expect(use.evidence).toHaveLength(1);
  expect(h.calls.filter((c) => c === 'POST /api/uses')).toHaveLength(1);
  expect(
    await database().db.select().from(vehicleUses).where(eq(vehicleUses.client_request_id, h.draft.id)),
  ).toHaveLength(1);
  expect(await database().db.select().from(evidence).where(eq(evidence.vehicle_use_id, use.id))).toHaveLength(
    1,
  );
});
it('생성 응답 유실 후 같은 키·본문 재전송은 사용 건 1개로 수렴한다', async () => {
  const h = await harness();
  h.lose();
  await sendDraft(h.draft, h.persist, h.io);
  expect(h.stored().phase).toBe('queued');
  await sendDraft(h.stored(), h.persist, h.io);
  expect(h.stored().phase).toBe('saved');
  expect(
    await database().db.select().from(vehicleUses).where(eq(vehicleUses.client_request_id, h.draft.id)),
  ).toHaveLength(1);
});
it('401 및 배정 회수 404는 영구 중단하고 앱 재시도에서도 보내지 않는다', async () => {
  for (const revoked of [false, true]) {
    const h = await harness();
    if (revoked)
      await database()
        .db.update(projectAssignments)
        .set({ revoked_at: new Date() })
        .where(eq(projectAssignments.id, h.s.assignment.id));
    else h.token('invalid');
    await sendDraft(h.draft, h.persist, h.io);
    expect(h.stored().phase).toBe('blocked');
    const count = h.calls.length;
    await sendDraft(h.stored(), h.persist, h.io);
    expect(h.calls).toHaveLength(count);
    expect(
      await database().db.select().from(vehicleUses).where(eq(vehicleUses.client_request_id, h.draft.id)),
    ).toHaveLength(0);
  }
});
it('계정 변경과 403에서는 전송을 중단한다', async () => {
  const h = await harness();
  await sendDraft(h.draft, h.persist, { ...h.io, isActive: () => false });
  expect(h.stored().phase).toBe('blocked');
  expect(h.calls).toHaveLength(0);
  const next = { ...h.stored(), phase: 'queued' as const };
  await sendDraft(next, h.persist, {
    ...h.io,
    get: async () => {
      throw new ApiError(403, 'FORBIDDEN', '권한 없음');
    },
  });
  expect(h.stored().phase).toBe('blocked');
});
it('수정 충돌은 최신 값을 저장하며 자동 덮어쓰기 하지 않는다', async () => {
  const h = await harness();
  const use = await createUse(h.s.driverCtx, h.s.input);
  h.draft.serverId = use.id;
  h.draft.version = use.version;
  h.draft.request = {
    key: crypto.randomUUID(),
    payload: { ...toInput(h.draft.form, 'driver'), version: use.version },
  };
  await updateUse(h.s.adminCtx, use.id, { version: use.version, notes: '담당자 최신 값' });
  await sendDraft(h.draft, h.persist, h.io);
  expect(h.stored().phase).toBe('conflict');
  expect(h.stored().conflict?.notes).toBe('담당자 최신 값');
  expect((await getUse(h.s.driverCtx, use.id)).notes).toBe('담당자 최신 값');
});
it('보완 후 재제출은 SUBMITTED, 대리 입력은 작성자·기사 분리와 내용 확인을 유지한다', async () => {
  const h = await harness();
  let use = await createUse(h.s.adminCtx, {
    ...h.s.input,
    trips: [{ seq: 1, origin: '상차', destination: '도착' }],
  });
  expect(use.entered_as).toBe('PROXY');
  expect(use.created_by_user_id).toBe(h.s.admin.id);
  expect(use.created_by_name).toBe(h.s.admin.name);
  expect(use.driver_id).toBe(h.s.driver.id);
  use = await confirmByDriver(h.s.driverCtx, use.id, { version: use.version });
  expect(use.driver_confirmed_at).not.toBeNull();
  use = await submitUse(h.s.driverCtx, use.id, { version: use.version });
  use = await requestFix(h.s.adminCtx, use.id, {
    version: use.version,
    fix_items: [{ target: 'trip:1.destination', message: '하차장 상세 입력' }],
  });
  use = await updateUse(h.s.driverCtx, use.id, {
    version: use.version,
    trips: [{ id: use.trips[0].id, seq: 1, origin: '상차', destination: '도착 2문' }],
  });
  use = await submitUse(h.s.driverCtx, use.id, { version: use.version });
  expect(use.review_status).toBe('SUBMITTED');
  expect(use.revisions[0].snapshot).toBeTruthy();
});
it('선택 목록은 과거 사용일의 소속을 반환하고 다른 기사·고객·연락처는 제외한다', async () => {
  const h = await harness();
  const old = await h.s.f.counterparty({ name: '과거 운송사' });
  await h.s.f.affiliation(h.s.driver.id, old.id, { valid_from: '2025-01-01', valid_to: '2025-12-31' });
  const lookups = await getLookups(h.s.driverCtx, '2025-03-01');
  expect(lookups.counterparties.map((p) => p.id)).toContain(old.id);
  expect(lookups.drivers.map((d) => d.id)).toEqual([h.s.driver.id]);
  expect(JSON.stringify(lookups)).not.toContain('bank_account');
  expect(
    lookups.affiliations.every(
      (a) => a.valid_from <= '2025-03-01' && (!a.valid_to || a.valid_to >= '2025-03-01'),
    ),
  ).toBe(true);
});
