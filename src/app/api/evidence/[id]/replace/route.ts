import { withRoute } from '@/server/http';
export const runtime = 'nodejs';
import { replaceEvidence } from '@/server/services/evidence';
import { uuid, evidenceSchema } from '@/server/services/schemas';
import { z } from 'zod';
export const POST = withRoute(async ({ ctx, params, input }) => replaceEvidence(ctx, uuid.parse(params.id), input.evidence, input.reason), { schema: z.object({ evidence: evidenceSchema, reason: z.string().min(1).max(1000) }).strict(), idempotent: true });
