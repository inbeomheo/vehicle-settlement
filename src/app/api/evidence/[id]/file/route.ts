import { withRoute } from '@/server/http';
export const runtime = 'nodejs';
import { downloadEvidence } from '@/server/services/evidence';
import { uuid } from '@/server/services/schemas';
export const GET = withRoute(async ({ ctx, params }) => { const { file, bytes } = await downloadEvidence(ctx, uuid.parse(params.id)); return new Response(new Uint8Array(bytes), { headers: { 'content-type': file.mime ?? 'application/octet-stream', 'content-length': String(bytes.length), 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.original_name ?? '증빙')}`, 'x-content-type-options': 'nosniff' } }); });
