import { describe, expect, it } from 'vitest';
import { testDatabase } from '../helpers/database';
import { streamingRequest } from '../helpers/request-stream';
import { withDatabase } from '../../src/server/db/client';
import { POST as loginRoute } from '../../src/app/api/auth/login/route';
import { POST as inviteRoute } from '../../src/app/api/invites/[id]/accept/route';
import { withRoute } from '../../src/server/http';
import { readBoundedBody } from '../../src/server/request-body';
import { readUpload } from '../../src/server/services/evidence';
const database = testDatabase();
describe('F9 요청 경계', () => {
  it.each([
    ['login', loginRoute],
    ['invite', inviteRoute],
    ['json', withRoute(async () => ({}), { auth: false })],
  ] as const)('%s: 길이 없는 JSON은 초과 즉시 취소하고 413', async (_name, route) => {
    const input = streamingRequest(1024 * 1024);
    const response = await withDatabase(database().db, () =>
      route(input.request, { params: Promise.resolve({ id: 'token' }) }),
    );
    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(input.state()).toEqual({ emitted: 3, cancelled: true });
  });
  it('증빙은 과대 Content-Length를 읽기 전에 413으로 취소', async () => {
    const input = streamingRequest(8, { 'content-length': String(20 * 1024 * 1024 + 1) });
    await expect(readUpload(input.request)).rejects.toMatchObject({ status: 413, code: 'PAYLOAD_TOO_LARGE' });
    expect(input.state()).toEqual({ emitted: 0, cancelled: true });
  });
  it('공유 reader는 작은 한도로 실제 바이트를 세고 거짓 길이를 무시', async () => {
    const input = streamingRequest(8, { 'content-length': '1' });
    await expect(readBoundedBody(input.request, 16)).rejects.toMatchObject({ status: 413 });
    expect(input.state()).toEqual({ emitted: 3, cancelled: true });
    const exact = new Request('http://localhost', { method: 'POST', body: '가가' });
    expect((await readBoundedBody(exact, 6)).toString()).toBe('가가');
  });
});
