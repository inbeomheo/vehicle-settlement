import { createHash, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from './db/client';
import { idempotencyKeys, vehicleUses } from './db/schema';
import { authenticate } from './auth/session';
import type { Context } from './context';
import { AppError, invalid } from './errors';
import { assertActive, assertCanReadUse, redactForDriver } from './authz';
export { AppError } from './errors';
type Params = Record<string, string>;
type RouteArgs<T, A extends boolean> = {
  request: Request;
  params: Params;
  input: T;
  ctx: A extends false ? null : Context;
  db: Db;
  request_id: string;
};
type Options<T, A extends boolean> = {
  schema?: z.ZodType<T>;
  source?: 'json' | 'query' | 'none';
  auth?: A;
  idempotent?: boolean;
  roles?: Context['user']['role'][];
  // Transform only the persisted/replayed JSON; the initial response remains intact.
  redactStored?: (body: unknown) => unknown;
};
export type RouteHandler = (request: Request, route: { params: Promise<Params> }) => Promise<Response>;
export function json(data: unknown, status = 200, headers?: HeadersInit) {
  return Response.json({ data }, { status, headers });
}
function rootError(error: unknown): { code?: string } {
  if (error && typeof error === 'object') {
    if ('cause' in error && error.cause) return rootError(error.cause);
    return error;
  }
  return {};
}
export function errorResponse(error: unknown, requestId: string): Response {
  const headers = { 'x-request-id': requestId, 'cache-control': 'no-store' };
  if (error instanceof AppError)
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      },
      { status: error.status, headers },
    );
  if (error instanceof z.ZodError)
    return Response.json(
      {
        error: {
          code: 'VALIDATION_FAILED',
          message: '입력 내용을 확인하세요.',
          details: error.issues.map((i) => ({
            path: i.path,
            message: i.code === 'custom' ? i.message : '형식 또는 값이 올바르지 않습니다.',
          })),
        },
      },
      { status: 422, headers },
    );
  if (
    error instanceof RangeError ||
    ['23505', '23503', '23514', '22003'].includes(rootError(error).code ?? '')
  )
    return Response.json(
      {
        error: {
          code: 'VALIDATION_FAILED',
          message:
            error instanceof RangeError
              ? error.message
              : '중복되거나 참조할 수 없는 값입니다. 입력 내용을 확인하세요.',
        },
      },
      { status: 422, headers },
    );
  console.error('요청 처리 실패', { request_id: requestId, error });
  return Response.json(
    { error: { code: 'INTERNAL_ERROR', message: '요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.' } },
    { status: 500, headers },
  );
}
async function authorizeReplay(ctx: Context, body: unknown): Promise<void> {
  if (!body || typeof body !== 'object') return;
  // W4 records must recheck the entire statement scope after assignment/role revocation.
  if ('statement_id' in body && typeof body.statement_id === 'string') {
    const { rawStatement } = await import('./services/statements');
    await rawStatement(ctx, body.statement_id);
  } else if ('statement_no' in body && 'id' in body && typeof body.id === 'string') {
    const { rawStatement } = await import('./services/statements');
    await rawStatement(ctx, body.id);
  }
  if ('id' in body && 'use_no' in body && typeof body.id === 'string') {
    const [current] = await ctx.db.select().from(vehicleUses).where(eq(vehicleUses.id, body.id));
    if (!current) throw new AppError('NOT_FOUND', '자료를 찾을 수 없습니다.');
    await assertCanReadUse(ctx, current);
  }
  if (
    'project_id' in body &&
    'driver_id' in body &&
    typeof body.project_id === 'string' &&
    typeof body.driver_id === 'string'
  )
    await assertCanReadUse(ctx, { project_id: body.project_id, driver_id: body.driver_id });
  if ('vehicle_use_id' in body && typeof body.vehicle_use_id === 'string') {
    const [use] = await ctx.db.select().from(vehicleUses).where(eq(vehicleUses.id, body.vehicle_use_id));
    if (!use) throw new AppError('NOT_FOUND', '자료를 찾을 수 없습니다.');
    await assertCanReadUse(ctx, use);
  }
  for (const value of Object.values(body)) {
    if (value && typeof value === 'object') await authorizeReplay(ctx, value);
  }
}
export function withRoute<T = undefined, A extends boolean = true>(
  handler: (args: RouteArgs<T, A>) => Promise<unknown>,
  options: Options<T, A> = {},
): RouteHandler {
  return async (request, route) => {
    const requestId = randomUUID();
    try {
      const db = getDb();
      const params = await (route?.params ?? Promise.resolve({}));
      const mutation = !['GET', 'HEAD'].includes(request.method);
      if (mutation) {
        const origin = request.headers.get('origin');
        const allowed = new URL(process.env.APP_URL ?? request.url).origin;
        if (origin && origin !== new URL(request.url).origin && origin !== allowed)
          throw new AppError('FORBIDDEN', '허용되지 않은 요청 출처입니다.');
      }
      const ctx = options.auth === false ? null : await authenticate(db, request, requestId);
      if (ctx && options.roles && !options.roles.includes(ctx.user.role))
        throw new AppError('FORBIDDEN', '이 작업에 필요한 권한이 없습니다.');
      let raw: unknown;
      let rawText = '';
      if (options.source === 'query') raw = Object.fromEntries(new URL(request.url).searchParams);
      else if (options.source !== 'none' && mutation) {
        if (Number(request.headers.get('content-length')) > 2 * 1024 * 1024)
          invalid('요청 크기가 너무 큽니다.');
        rawText = await request.text();
        if (Buffer.byteLength(rawText) > 2 * 1024 * 1024) invalid('요청 크기가 너무 큽니다.');
        try {
          raw = rawText ? JSON.parse(rawText) : {};
        } catch {
          invalid('JSON 형식을 확인하세요.');
        }
      }
      const input = options.schema ? options.schema.parse(raw) : (raw as T);
      const invoke = async (connection: Db, context: Context | null) => {
        const result = await handler({
          request,
          params,
          input,
          ctx: context,
          db: connection,
          request_id: requestId,
        } as RouteArgs<T, A>);
        return result instanceof Response
          ? result
          : json(context ? redactForDriver(context, result) : result);
      };
      const key = request.headers.get('idempotency-key');
      let response: Response;
      if (options.idempotent && key && ctx) {
        if (key.length > 200 || !key.trim()) invalid('멱등 키를 확인하세요.');
        const routeKey = `${request.method} ${new URL(request.url).pathname}`;
        const hash = createHash('sha256').update(`${routeKey}\n${rawText}`).digest('hex');
        response = await db.transaction(async (tx) => {
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${ctx.user.id}:${key}`}, 0))`,
          );
          const currentCtx = { ...ctx, db: tx };
          await assertActive(currentCtx);
          if (options.roles && !options.roles.includes(currentCtx.user.role))
            throw new AppError('FORBIDDEN', '이 작업에 필요한 권한이 없습니다.');
          const [prior] = await tx
            .select()
            .from(idempotencyKeys)
            .where(and(eq(idempotencyKeys.user_id, ctx.user.id), eq(idempotencyKeys.key, key)));
          if (prior) {
            if (prior.route !== routeKey || prior.request_hash !== hash)
              throw new AppError('IDEMPOTENCY_MISMATCH', '같은 멱등 키에 다른 요청을 보낼 수 없습니다.');
            await authorizeReplay(currentCtx, prior.response_body);
            return Response.json(redactForDriver(currentCtx, prior.response_body), {
              status: prior.status_code,
              headers: { 'idempotency-replayed': 'true' },
            });
          }
          const result = await invoke(tx, currentCtx);
          if (result.ok) {
            const body = await result.clone().json();
            await tx.insert(idempotencyKeys).values({
              user_id: ctx.user.id,
              key,
              route: routeKey,
              request_hash: hash,
              status_code: result.status,
              response_body: options.redactStored ? options.redactStored(body) : body,
            });
          }
          return result;
        });
      } else response = await invoke(db, ctx);
      response.headers.set('x-request-id', requestId);
      response.headers.set('cache-control', 'no-store');
      return response;
    } catch (error) {
      return errorResponse(error, requestId);
    }
  };
}
