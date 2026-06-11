import type { IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import type { JsonObject } from '@megumi/shared/primitives';
import type {
  BusinessIpcChannel,
  RuntimeIpcRequest,
  RuntimeIpcResult,
} from '@megumi/shared/ipc';
import { RuntimeIpcRequestIdSchema } from '@megumi/shared/ipc';
import type { RuntimeIpcError } from '@megumi/shared/ipc';
import { sanitizeZodIssues } from '@megumi/shared/ipc';
import type { RuntimeContext } from '@megumi/shared/runtime';
import {
  RuntimeContextSchema,
  createRuntimeDebugId,
  createRuntimeTraceId,
} from '@megumi/shared/runtime';
import { normalizeRuntimeError } from '@megumi/core/agent-runtime';
import type { RuntimeError } from '@megumi/shared/runtime';
import {
  redactRuntimeDetails,
  redactRuntimeMessage,
  redactRuntimeValue,
} from '@megumi/security/redaction';
import {
  noopRuntimeLogger,
  type RuntimeLogger,
} from '../services/runtime/runtime-logger.service';
import { runtimeOperationNameFromChannel } from './runtime-operation-name';

export interface RuntimeIpcHandlerOptions<
  TPayload,
  TData extends object,
  TChannel extends BusinessIpcChannel,
  TRequest extends RuntimeIpcRequest<TPayload, TChannel> = RuntimeIpcRequest<TPayload, TChannel>,
> {
  channel: TChannel;
  requestSchema: z.ZodType<TRequest>;
  handle: (
    request: TRequest,
    event: IpcMainInvokeEvent,
    context: RuntimeContext,
  ) => Promise<TData> | TData;
  mapError?: (error: unknown, request: TRequest, context: RuntimeContext) => RuntimeIpcError;
  logger?: RuntimeLogger;
  now?: () => Date;
  traceIdFactory?: () => string;
  debugIdFactory?: () => string;
}

export function createRuntimeIpcHandler<
  TPayload,
  TData extends object,
  TChannel extends BusinessIpcChannel,
  TRequest extends RuntimeIpcRequest<TPayload, TChannel> = RuntimeIpcRequest<TPayload, TChannel>,
>(options: RuntimeIpcHandlerOptions<TPayload, TData, TChannel, TRequest>) {
  const logger = options.logger ?? noopRuntimeLogger;
  const now = options.now ?? (() => new Date());
  const traceIdFactory = options.traceIdFactory ?? createRuntimeTraceId;
  const debugIdFactory = options.debugIdFactory ?? createRuntimeDebugId;

  return async (
    event: IpcMainInvokeEvent,
    rawRequest: unknown,
  ): Promise<RuntimeIpcResult<TData, TChannel>> => {
    const startedAt = now();
    const parsed = options.requestSchema.safeParse(rawRequest);
    const requestId = parsed.success ? parsed.data.requestId : extractRequestId(rawRequest);
    const context = createHandlerContext({
      channel: options.channel,
      requestId,
      rawContext: extractRawContext(rawRequest),
      now,
      traceIdFactory,
    });

    if (!parsed.success) {
      const failureContext = ensureDebugContext(context, debugIdFactory);
      const details = sanitizeZodIssues(parsed.error) as unknown as JsonObject;
      const error: RuntimeIpcError = {
        code: 'ipc_invalid_request',
        message: 'Megumi received an invalid request.',
        severity: 'error',
        retryable: false,
        source: 'main',
        debugId: failureContext.debugId,
        details,
      };

      logger.warn('runtime.ipc.invalid_request', {
        channel: options.channel,
        requestId,
        traceId: failureContext.traceId,
        debugId: failureContext.debugId,
        operationName: failureContext.operationName,
        issueCount: details.issueCount,
      });

      return createFailureResult({
        channel: options.channel,
        requestId,
        context: failureContext,
        startedAt,
        handledAt: now(),
        error,
      });
    }

    try {
      const data = await options.handle(parsed.data, event, context);

      return {
        ok: true,
        data,
        meta: createResponseMeta({
          channel: options.channel,
          requestId: parsed.data.requestId,
          context,
          startedAt,
          handledAt: now(),
        }),
      };
    } catch (error) {
      const fallbackDebugContext = ensureDebugContext(context, debugIdFactory);
      const mapped = options.mapError
        ? options.mapError(error, parsed.data, fallbackDebugContext)
        : normalizeRuntimeError(error, {
            source: 'main',
            debugId: fallbackDebugContext.debugId,
          });
      const runtimeError = withRuntimeErrorDebugId(
        {
          ...mapped,
          details: redactRuntimeDetails(mapped.details) as JsonObject | undefined,
        },
        fallbackDebugContext.debugId,
      );
      const failureContext = {
        ...fallbackDebugContext,
        debugId: runtimeError.debugId,
      };

      logger.error('runtime.ipc.handler_failed', {
        channel: options.channel,
        requestId: parsed.data.requestId,
        traceId: failureContext.traceId,
        debugId: failureContext.debugId,
        operationName: failureContext.operationName,
        errorCode: runtimeError.code,
        errorSource: runtimeError.source,
        errorName: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? redactRuntimeMessage(error.message) : undefined,
        details: redactRuntimeValue(runtimeError.details),
      });

      return createFailureResult({
        channel: options.channel,
        requestId: parsed.data.requestId,
        context: failureContext,
        startedAt,
        handledAt: now(),
        error: runtimeError,
      });
    }
  };
}

function createHandlerContext(input: {
  channel: BusinessIpcChannel;
  requestId: string;
  rawContext: unknown;
  now: () => Date;
  traceIdFactory: () => string;
}): RuntimeContext {
  const parsed = RuntimeContextSchema.safeParse(input.rawContext);

  if (parsed.success) {
    return parsed.data;
  }

  return RuntimeContextSchema.parse({
    requestId: input.requestId,
    traceId: input.traceIdFactory(),
    operationName: runtimeOperationNameFromChannel(input.channel),
    source: 'main',
    createdAt: input.now().toISOString(),
  });
}

function ensureDebugContext(
  context: RuntimeContext,
  debugIdFactory: () => string,
): RuntimeContext & { debugId: string } {
  return {
    ...context,
    debugId: context.debugId ?? debugIdFactory(),
  };
}

function createResponseMeta<TChannel extends BusinessIpcChannel>(input: {
  channel: TChannel;
  requestId: string;
  context: RuntimeContext;
  startedAt: Date;
  handledAt: Date;
}) {
  return {
    requestId: input.requestId,
    channel: input.channel,
    traceId: input.context.traceId,
    debugId: input.context.debugId,
    operationName: input.context.operationName,
    handledAt: input.handledAt.toISOString(),
    durationMs: Math.max(0, input.handledAt.getTime() - input.startedAt.getTime()),
  };
}

function createFailureResult<TChannel extends BusinessIpcChannel>(input: {
  channel: TChannel;
  requestId: string;
  context: RuntimeContext;
  startedAt: Date;
  handledAt: Date;
  error: RuntimeIpcError;
}) {
  return {
    ok: false as const,
    error: input.error,
    meta: createResponseMeta({
      channel: input.channel,
      requestId: input.requestId,
      context: input.context,
      startedAt: input.startedAt,
      handledAt: input.handledAt,
    }),
  };
}

function withRuntimeErrorDebugId(error: RuntimeError, debugId: string): RuntimeIpcError {
  if (error.debugId) {
    return error;
  }

  return {
    ...error,
    debugId,
  };
}

function extractRequestId(rawRequest: unknown): string {
  if (
    rawRequest &&
    typeof rawRequest === 'object' &&
    'requestId' in rawRequest &&
    typeof (rawRequest as { requestId?: unknown }).requestId === 'string'
  ) {
    const result = RuntimeIpcRequestIdSchema.safeParse((rawRequest as { requestId: string }).requestId);

    if (result.success) {
      return result.data;
    }
  }

  return 'invalid-request';
}

function extractRawContext(rawRequest: unknown): unknown {
  if (rawRequest && typeof rawRequest === 'object' && 'context' in rawRequest) {
    return (rawRequest as { context?: unknown }).context;
  }

  return undefined;
}



