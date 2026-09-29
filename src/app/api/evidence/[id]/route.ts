import { withRoute } from '@/server/http';
export const runtime = 'nodejs';
import { deleteEvidence } from '@/server/services/evidence';
import { uuid } from '@/server/services/schemas';
import { z } from 'zod';
export const DELETE = withRoute(async ({ ctx, params, input }) => deleteEvidence(ctx, uuid.parse(params.id), input.reason), { schema: z.object({ reason: z.string().min(1).max(1000) }).strict(), idempotent: true });
