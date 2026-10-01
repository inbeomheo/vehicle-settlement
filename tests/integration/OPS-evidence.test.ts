import { afterEach, expect, it, vi } from 'vitest';
import { prepareImage } from '../../src/components/evidence/resize';
import { testDatabase } from '../helpers/database';
import { setupScenario } from '../helpers/factories';
import { createUse } from '../../src/server/services/uses';
import { createEvidence } from '../../src/server/services/evidence';
const database = testDatabase();
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it('PDF 4MiB 경계를 브라우저 준비와 서버 메타 검증이 동일하게 적용한다', async () => {
  const limit = 4 * 1024 * 1024;
  await expect(
    prepareImage(new File([new Uint8Array(limit + 1)], '초과.pdf', { type: 'application/pdf' })),
  ).rejects.toThrow('4MB 이하 PDF만 올릴 수 있어요');
  expect(
    (await prepareImage(new File([new Uint8Array(limit)], '경계.pdf', { type: 'application/pdf' }))).blob
      .size,
  ).toBe(limit);
  const scenario = await setupScenario(database().db);
  const use = await createUse(scenario.driverCtx, scenario.input);
  const metadata = {
    client_upload_id: crypto.randomUUID(),
    kind: 'RECEIPT' as const,
    mime: 'application/pdf' as const,
    original_name: '경계.pdf',
    size: limit,
  };
  await expect(
    createEvidence(scenario.driverCtx, use.id, { ...metadata, size: limit + 1 }),
  ).rejects.toThrow();
  expect((await createEvidence(scenario.driverCtx, use.id, metadata)).size).toBe(limit);
});

it('리사이즈 결과도 4MiB 초과면 큐에 넣기 전에 거부하고 비트맵을 닫는다', async () => {
  const close = vi.fn();
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 3000, height: 3000, close }));
  vi.stubGlobal('document', {
    createElement: () => ({
      getContext: () => ({ fillRect: vi.fn(), drawImage: vi.fn() }),
      toBlob: (done: (blob: Blob) => void) => done(new Blob([new Uint8Array(4 * 1024 * 1024 + 1)])),
    }),
  });
  await expect(prepareImage(new File(['image'], '사진.png', { type: 'image/png' }))).rejects.toThrow(
    '4MB 이하 사진',
  );
  expect(close).toHaveBeenCalledOnce();
});
