import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, mutate, type ApiError } from '../../src/client/api';
import { sendDraft, type Transport } from '../../src/client/offline/engine';
import type { Draft } from '../../src/client/offline/store';
import { initialValues } from '../../src/components/use-form/model';
import type { Lookups, UseDetail } from '../../src/client/types';

const server = {
  id: 'use-1',
  version: 1,
  review_status: 'DRAFT',
  trips: [],
  charge_lines: [],
  evidence: [],
} as unknown as UseDetail;

function queuedDraft(): Draft {
  return {
    id: 'draft-1',
    userId: 'driver-1',
    mode: 'driver',
    form: initialValues({ drivers: [], projects: [], vehicles: [], affiliations: [] } as unknown as Lookups),
    uploads: [
      { client_upload_id: 'file-1', kind: 'SLIP_NO', text_value: '전표 1', status: 'pending', progress: 0 },
    ],
    serverId: 'use-1',
    server,
    version: server.version,
    savedRequest: true,
    phase: 'queued',
    intent: 'save',
    updatedAt: 0,
  };
}
function transport() {
  return { get: api, mutate, upload: vi.fn(), isActive: () => true } satisfies Transport;
}
afterEach(() => vi.unstubAllGlobals());

describe('W6-1 증빙 전송 오류 분류', () => {
  it.each([400, 401, 403, 404, 409, 413, 422])(
    '%i 증빙 오류는 실제 사유를 보존하고 자동 재전송을 중단한다',
    async (status) => {
      const message =
        status === 409 ? '확정 명세에 포함되어 증빙을 변경할 수 없습니다.' : '첨부 형식을 확인하세요.';
      const fetch = vi.fn(async (url: string) => {
        if (url === '/api/me') return Response.json({ data: { id: 'driver-1' } });
        if (url.endsWith('/evidence'))
          return Response.json(
            { error: { code: status === 409 ? 'STATEMENT_LOCKED' : 'VALIDATION_FAILED', message } },
            { status },
          );
        return Response.json({ data: server });
      });
      vi.stubGlobal('fetch', fetch);
      const persist = vi.fn(async () => {});
      const draft = await sendDraft(queuedDraft(), persist, transport());
      expect(draft).toMatchObject({ phase: 'blocked', error: message });
      expect(draft.uploads[0]).toMatchObject({ status: 'failed', error: message });
      const calls = fetch.mock.calls.length;
      await sendDraft(draft, persist, transport());
      expect(fetch).toHaveBeenCalledTimes(calls);
    },
  );

  it.each([408, 429, 500, 503, 'network'] as const)(
    '%s는 증빙만 다시 보내고 저장 요청은 반복하지 않는다',
    async (status) => {
      let failing = true;
      const fetch = vi.fn(async (url: string) => {
        if (url === '/api/me') return Response.json({ data: { id: 'driver-1' } });
        if (url.endsWith('/evidence')) {
          if (!failing) return Response.json({ data: { id: 'evidence-1' } });
          if (status === 'network') throw new Error('연결 끊김');
          return Response.json(
            { error: { code: 'RETRY_LATER', message: '잠시 후 다시 시도하세요.' } },
            { status },
          );
        }
        return Response.json({ data: server });
      });
      vi.stubGlobal('fetch', fetch);
      const draft = await sendDraft(queuedDraft(), async () => {}, transport());
      expect(draft.phase).toBe('queued');
      failing = false;
      await sendDraft(draft, async () => {}, transport());
      expect(draft.phase).toBe('saved');
      expect(fetch.mock.calls.filter(([url]) => url === '/api/uses')).toHaveLength(0);
    },
  );

  it.each([408, 429])('%i 사용 건 저장 오류도 영구 차단하지 않는다', async (status) => {
    vi.stubGlobal('fetch', async (url: string) =>
      url === '/api/me'
        ? Response.json({ data: { id: 'driver-1' } })
        : Response.json({ error: { code: 'RETRY_LATER', message: '잠시 후 다시 시도하세요.' } }, { status }),
    );
    const draft = queuedDraft();
    draft.savedRequest = false;
    draft.request = {
      key: 'save-1',
      payload: { use_date: '2026-09-01', project_id: 'project', driver_id: 'driver', vehicle_id: 'vehicle' },
    };
    await sendDraft(draft, async () => {}, transport());
    expect(draft.phase).toBe('queued');
  });

  it('바이너리 422도 파일과 초안에 오류를 보관하고 중단한다', async () => {
    const draft = queuedDraft();
    draft.uploads[0] = {
      ...draft.uploads[0],
      kind: 'PHOTO',
      serverId: 'file-1',
      blob: new Blob(['bad'], { type: 'image/jpeg' }),
    };
    vi.stubGlobal('fetch', async (url: string) =>
      Response.json({
        data: url === '/api/me' ? { id: 'driver-1' } : server,
      }),
    );
    const { ApiError } = await import('../../src/client/api');
    const error: ApiError = new ApiError(422, 'VALIDATION_FAILED', '실제 이미지 형식과 일치하지 않습니다.');
    const io = {
      ...transport(),
      upload: vi.fn(async () => {
        throw error;
      }),
    };
    await sendDraft(draft, async () => {}, io);
    expect(draft).toMatchObject({ phase: 'blocked', error: error.message });
  });
});
