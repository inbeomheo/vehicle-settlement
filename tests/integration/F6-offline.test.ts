import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { callRoute } from '../helpers/routes';
import { ApiError } from '../../src/client/api';
import type { UseDetail } from '../../src/client/types';
import { sendDraft, type Transport } from '../../src/client/offline/engine';
import type { Draft } from '../../src/client/offline/store';
import { fromUse, toInput } from '../../src/components/use-form/model';
import { createUse, getUse, updateUse, requestFix } from '../../src/server/services/uses';
import { vehicleUses } from '../../src/server/db/schema';
import { GET as me } from '../../src/app/api/me/route';
import { GET as get, PATCH as patch } from '../../src/app/api/uses/[id]/route';
import { POST as create } from '../../src/app/api/uses/route';
import { POST as submit } from '../../src/app/api/uses/[id]/submit/route';
import { POST as metadata } from '../../src/app/api/uses/[id]/evidence/route';
const database = testDatabase();
const json = (value: Awaited<ReturnType<typeof getUse>>): UseDetail => JSON.parse(JSON.stringify(value));

async function harness(isNew = false) {
  const s = await setupScenario(database().db);
  const use = await createUse(s.driverCtx, { ...s.input, notes: '기사 원본' });
  const token = (await s.f.session(s.driverUser.id)).token;
  const form = fromUse(json(use), 'driver');
  if (isNew) {
    form.trips.forEach((trip) => {
      delete trip.id;
    });
    form.charges.forEach((charge) => {
      delete charge.id;
    });
  }
  const draft: Draft = {
    id: crypto.randomUUID(),
    userId: s.driverUser.id,
    mode: 'driver',
    form,
    uploads: [],
    ...(isNew ? {} : { serverId: use.id, server: json(use), version: use.version }),
    phase: 'queued',
    intent: 'submit',
    updatedAt: Date.now(),
    savedRequest: false,
  };
  draft.request = {
    key: crypto.randomUUID(),
    payload: {
      ...toInput(form, 'driver'),
      ...(isNew ? { client_request_id: draft.id } : { version: use.version }),
    },
  };
  let lose: 'create' | 'submit' | undefined;
  let failGet = false;
  const calls: { url: string; method: string; body: unknown; key?: string }[] = [];
  const invoke = async <T>(url: string, method = 'GET', body?: unknown, key?: string): Promise<T> => {
    calls.push({ url, method, body: structuredClone(body), key });
    if (failGet && method === 'GET' && url.startsWith('/api/uses/')) throw new Error('네트워크 중단');
    const handler =
      url === '/api/me'
        ? me
        : url === '/api/uses'
          ? create
          : url.endsWith('/submit')
            ? submit
            : url.endsWith('/evidence')
              ? metadata
              : method === 'PATCH'
                ? patch
                : get;
    const response = await callRoute(database().db, handler, {
      path: url,
      method,
      params: { id: url.split('/')[3] },
      token,
      body,
      headers: key ? { 'idempotency-key': key } : {},
    });
    const result = await response.json();
    if (!response.ok)
      throw new ApiError(response.status, result.error.code, result.error.message, result.error.details);
    if ((lose === 'create' && url === '/api/uses') || (lose === 'submit' && url.endsWith('/submit'))) {
      lose = undefined;
      throw new Error('응답 유실');
    }
    return result.data;
  };
  const io: Transport = {
    get: (url) => invoke(url),
    mutate: (url, body, key, method) => invoke(url, method ?? 'POST', body, key),
    upload: async () => {},
    isActive: () => true,
  };
  let stored = structuredClone(draft);
  return {
    s,
    use,
    draft,
    io,
    calls,
    persist: async (value: Draft) => {
      stored = structuredClone(value);
    },
    stored: () => structuredClone(stored),
    lose: (kind: typeof lose) => {
      lose = kind;
    },
    getFailure: (value: boolean) => {
      failGet = value;
    },
  };
}

it('R7-2 생성 응답 유실 → 첨부 취소 → 편집 후 원본 재생과 version PATCH로 저장한다', async () => {
  const h = await harness(true);
  h.draft.intent = 'save';
  h.draft.uploads = [
    {
      client_upload_id: crypto.randomUUID(),
      kind: 'SLIP_NO',
      text_value: '취소할 첨부',
      status: 'pending',
      progress: 0,
    },
  ];
  const original = structuredClone(h.draft.request);
  h.lose('create');
  await sendDraft(h.draft, h.persist, h.io);
  expect(h.stored()).toMatchObject({ phase: 'queued' });
  expect(h.stored().serverId).toBeUndefined();
  // The form discards the editable request on cancellation, but recovery must survive it.
  const edited: Draft = {
    ...h.stored(),
    uploads: [],
    phase: 'editing',
    request: undefined,
    savedRequest: false,
    submitRequest: undefined,
  };
  edited.form.notes = '첨부 취소 후 수정';
  edited.form.charges[0].quantity = '2';
  edited.phase = 'queued';
  edited.request = {
    key: crypto.randomUUID(),
    payload: { ...toInput(edited.form, 'driver'), client_request_id: edited.id },
  };
  await sendDraft(edited, h.persist, h.io);
  expect(h.stored().phase).toBe('saved');
  const actual = await getUse(h.s.driverCtx, h.stored().serverId!);
  expect(actual.notes).toBe('첨부 취소 후 수정');
  expect(actual.charge_lines[0].quantity).toBe('2.000');
  expect(actual.evidence).toHaveLength(0);
  const creates = h.calls.filter((c) => c.url === '/api/uses');
  expect(creates).toHaveLength(2);
  expect(creates[1]).toMatchObject({ key: original!.key, body: original!.payload });
  expect(h.calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  expect(
    await database().db.select().from(vehicleUses).where(eq(vehicleUses.client_request_id, edited.id)),
  ).toHaveLength(1);
});

it.each(['save', 'submit'] as const)(
  'R7-3 재전송 %s는 저장 후 담당자 수량 9 변경을 충돌로 멈춘다',
  async (intent) => {
    const h = await harness();
    h.draft.intent = intent;
    h.getFailure(true);
    await sendDraft(h.draft, h.persist, h.io);
    expect(h.stored().phase).toBe('queued');
    const saved = await getUse(h.s.driverCtx, h.use.id);
    const changed = await updateUse(h.s.adminCtx, h.use.id, {
      version: saved.version,
      quantity: '9',
      notes: '담당자 최신 수정',
    });
    h.getFailure(false);
    await sendDraft(h.stored(), h.persist, h.io);
    expect(h.stored().phase).toBe('conflict');
    expect(h.stored().conflict).toMatchObject({ version: changed.version, notes: changed.notes });
    expect(h.stored().form.notes).toBe('기사 원본');
    const actual = await getUse(h.s.driverCtx, h.use.id);
    expect(actual.review_status).toBe('DRAFT');
    expect(actual.charge_lines[0].quantity).toBe('9.000');
    expect(h.calls.some((c) => c.url.endsWith('/submit'))).toBe(false);
  },
);

it('R7-3 자기 증빙만 추가한 version 증가는 재전송과 제출을 허용한다', async () => {
  const h = await harness();
  h.draft.uploads = [
    {
      client_upload_id: crypto.randomUUID(),
      kind: 'SLIP_NO',
      text_value: '내 전표',
      status: 'pending',
      progress: 0,
    },
  ];
  h.getFailure(true);
  await sendDraft(h.draft, h.persist, h.io);
  h.getFailure(false);
  await sendDraft(h.stored(), h.persist, h.io);
  expect(h.stored().phase).toBe('saved');
  expect(h.stored().server?.review_status).toBe('SUBMITTED');
  expect(h.stored().server?.evidence).toHaveLength(1);
  expect(h.calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
});

it('R7-4 응답 유실 후 보완요청된 제출은 최신 NEEDS_FIX 상태로 표시한다', async () => {
  const h = await harness();
  h.lose('submit');
  await sendDraft(h.draft, h.persist, h.io);
  expect(h.stored().phase).toBe('queued');
  const submitted = await getUse(h.s.driverCtx, h.use.id);
  const latest = await requestFix(h.s.adminCtx, h.use.id, {
    version: submitted.version,
    fix_items: [{ target: 'trip:1.destination', message: '도착지 상세 보완' }],
  });
  await sendDraft(h.stored(), h.persist, h.io);
  expect(h.stored()).toMatchObject({
    phase: 'saved',
    version: latest.version,
    server: { review_status: 'NEEDS_FIX', version: latest.version },
  });
  expect(h.stored().server?.revisions[0].fix_items).toEqual(latest.revisions[0].fix_items);
  expect((await getUse(h.s.driverCtx, h.use.id)).current_revision_no).toBe(1);
});

it('R7-3 자기 증빙과 담당자 수정이 함께 있으면 증빙의 version 증가로 숨기지 않는다', async () => {
  const h = await harness();
  h.draft.uploads = [
    {
      client_upload_id: crypto.randomUUID(),
      kind: 'SLIP_NO',
      text_value: '내 전표',
      status: 'pending',
      progress: 0,
    },
  ];
  const io: Transport = {
    ...h.io,
    mutate: async <T>(...args: Parameters<Transport['mutate']>): Promise<T> => {
      const result = await h.io.mutate<T>(...args);
      if (args[0].endsWith('/evidence')) h.getFailure(true);
      return result;
    },
  };
  await sendDraft(h.draft, h.persist, io);
  expect(h.stored().uploads[0].status).toBe('uploaded');
  const saved = await getUse(h.s.driverCtx, h.use.id);
  await updateUse(h.s.adminCtx, h.use.id, { version: saved.version, quantity: '9' });
  h.getFailure(false);
  await sendDraft(h.stored(), h.persist, h.io);
  expect(h.stored().phase).toBe('conflict');
  expect((await getUse(h.s.driverCtx, h.use.id)).review_status).toBe('DRAFT');
});

it('R7-3 화면용 최신 상세를 읽어도 저장 기준과 낙관적 버전을 승격하지 않는다', async () => {
  const h = await harness();
  h.getFailure(true);
  await sendDraft(h.draft, h.persist, h.io);
  const saved = await getUse(h.s.driverCtx, h.use.id);
  const changed = await updateUse(h.s.adminCtx, h.use.id, { version: saved.version, quantity: '9' });
  const reloaded = h.stored();
  reloaded.server = json(changed);
  h.getFailure(false);
  await sendDraft(reloaded, h.persist, h.io);
  expect(h.stored().phase).toBe('conflict');
  expect(h.stored().version).toBe(saved.version);
});

it('R7-4 제출 성공 뒤 최신 GET 실패도 완료 표시하지 않고 같은 제출을 재생한다', async () => {
  const h = await harness();
  const io: Transport = {
    ...h.io,
    mutate: async <T>(...args: Parameters<Transport['mutate']>): Promise<T> => {
      const result = await h.io.mutate<T>(...args);
      if (args[0].endsWith('/submit')) h.getFailure(true);
      return result;
    },
  };
  await sendDraft(h.draft, h.persist, io);
  expect(h.stored().phase).toBe('queued');
  const submitted = await getUse(h.s.driverCtx, h.use.id);
  await requestFix(h.s.adminCtx, h.use.id, {
    version: submitted.version,
    fix_items: [{ target: 'trip:1.destination', message: '보완해주세요' }],
  });
  h.getFailure(false);
  await sendDraft(h.stored(), h.persist, h.io);
  expect(h.stored()).toMatchObject({ phase: 'saved', server: { review_status: 'NEEDS_FIX' } });
  const requests = h.calls.filter((call) => call.url.endsWith('/submit'));
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
});

it('명확히 거부된 생성은 본문을 고친 새 요청으로 저장할 수 있다', async () => {
  const h = await harness(true);
  h.draft.intent = 'save';
  h.draft.request!.payload.project_id = 'invalid-project';
  await sendDraft(h.draft, h.persist, h.io);
  expect(h.stored().phase).toBe('blocked');
  const corrected = h.stored();
  corrected.phase = 'queued';
  corrected.request = {
    key: crypto.randomUUID(),
    payload: { ...toInput(corrected.form, 'driver'), client_request_id: corrected.id },
  };
  await sendDraft(corrected, h.persist, h.io);
  expect(h.stored().phase).toBe('saved');
});
