import { uploadLimit, uploadLimitMessage } from '@/server/upload-limits';
import { withRoute } from '@/server/http';
import { invalid } from '@/server/errors';
import { uploadImport, assertImportUploadAccess } from '@/server/services/import';
export const POST = withRoute(
  async ({ ctx, request }) => {
    await assertImportUploadAccess(ctx);
    if (Number(request.headers.get('content-length')) > uploadLimit(11 * 1024 * 1024))
      invalid(uploadLimitMessage(uploadLimit(10 * 1024 * 1024)));
    const reader = request.body?.getReader();
    if (!reader) invalid('파일을 선택하세요.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > uploadLimit(11 * 1024 * 1024)) {
        await reader.cancel();
        invalid(uploadLimitMessage(uploadLimit(10 * 1024 * 1024)));
      }
      chunks.push(value);
    }
    let form: FormData;
    try {
      form = await new Response(Buffer.concat(chunks), {
        headers: { 'content-type': request.headers.get('content-type') ?? '' },
      }).formData();
    } catch {
      invalid('파일 업로드 형식을 확인하세요.');
    }
    const file = form.get('file');
    if (!(file instanceof File)) invalid('파일을 선택하세요.');
    return uploadImport(ctx, file.name, Buffer.from(await file.arrayBuffer()));
  },
  { source: 'none', roles: ['ADMIN', 'SITE_MANAGER', 'SETTLEMENT_MANAGER'] },
);
