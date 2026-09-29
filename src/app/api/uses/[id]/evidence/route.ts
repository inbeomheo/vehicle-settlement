import { withRoute } from '@/server/http';
export const runtime = 'nodejs';
import { createEvidence } from '@/server/services/evidence';
import { evidenceSchema, uuid } from '@/server/services/schemas';
export const POST = withRoute(
  async ({ ctx, params, input }) => createEvidence(ctx, uuid.parse(params.id), input),
  { schema: evidenceSchema, idempotent: true },
);
