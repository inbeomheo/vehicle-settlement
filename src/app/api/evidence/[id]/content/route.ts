import { withRoute } from '@/server/http';
export const runtime = 'nodejs';
import { uploadEvidence, readUpload, markUploadFailed } from '@/server/services/evidence';
import { uuid } from '@/server/services/schemas';
export const PUT = withRoute(async ({ ctx, params, request }) => { const id = uuid.parse(params.id); let bytes: Buffer; try { bytes = await readUpload(request); } catch (e) { await markUploadFailed(ctx, id, '파일 읽기 실패'); throw e; } return uploadEvidence(ctx, id, bytes, request.headers.get('content-type')?.split(';')[0] ?? ''); }, { source: 'none' });
