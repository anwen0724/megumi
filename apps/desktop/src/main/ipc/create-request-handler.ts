/*
 * Wraps Electron IPC handlers with request validation and normalized results.
 */
import type { IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import { createRuntimeDebugId, type RuntimeContext } from '@megumi/coding-agent/events';
import type { RuntimeLogger } from '@megumi/product/logging';
import type { BusinessIpcChannel, RuntimeIpcRequest, RuntimeIpcResult } from './contracts';
import type { RuntimeIpcError } from './errors';
import { sanitizeZodIssues } from './errors';

export interface CreateIpcRequestHandlerOptions<
  TPayload,
  TData extends object,
  TChannel extends BusinessIpcChannel,
> {
  channel: TChannel;
  requestSchema: z.ZodType<RuntimeIpcRequest<TPayload, TChannel>>;
  responseSchema?: z.ZodType<TData>;
  logger?: RuntimeLogger;
  handle(
    request: RuntimeIpcRequest<TPayload, TChannel>,
    event: IpcMainInvokeEvent,
    context: RuntimeContext,
  ): TData | Promise<TData>;
  mapError?(error: unknown): RuntimeIpcError;
}

export function createIpcRequestHandler<
  TPayload,
  TData extends object,
  TChannel extends BusinessIpcChannel,
>(options: CreateIpcRequestHandlerOptions<TPayload, TData, TChannel>) {
  return async (
    event: IpcMainInvokeEvent,
    rawRequest: unknown,
  ): Promise<RuntimeIpcResult<TData, TChannel>> => {
    const startedAt = Date.now();
    const parsed = options.requestSchema.safeParse(rawRequest);
    const requestId = parsed.success && typeof parsed.data.requestId === 'string'
      ? parsed.data.requestId
      : 'request:invalid';

    if (!parsed.success) {
      return failureResult(options.channel, requestId, {
        code: 'ipc_invalid_request',
        message: 'IPC request payload is invalid.',
        severity: 'error',
        retryable: false,
        source: 'main',
        details: { validation: JSON.stringify(sanitizeZodIssues(parsed.error)) },
      }, startedAt);
    }

    const context = parsed.data.context ?? {
      requestId: parsed.data.requestId,
      traceId: `trace-${parsed.data.requestId}`,
      debugId: createRuntimeDebugId(),
      operationName: parsed.data.meta.channel,
      source: 'renderer' as const,
      createdAt: parsed.data.meta.createdAt,
    };

    try {
      const handled = await options.handle(parsed.data, event, context);
      const data = options.responseSchema ? options.responseSchema.parse(handled) : handled;
      return {
        ok: true,
        data,
        meta: {
          requestId: parsed.data.requestId,
          channel: options.channel,
          traceId: context.traceId,
          debugId: context.debugId,
          operationName: context.operationName,
          handledAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
        },
      };
    } catch (error) {
      options.logger?.error?.('IPC handler failed.', { error: String(error) });
      return failureResult(
        options.channel,
        parsed.data.requestId,
        options.mapError?.(error) ?? {
          code: 'ipc_handler_failed',
          message: 'IPC handler failed.',
          severity: 'error',
          retryable: true,
          source: 'main',
        },
        startedAt,
      );
    }
  };
}

function failureResult<TChannel extends BusinessIpcChannel>(
  channel: TChannel,
  requestId: string,
  error: RuntimeIpcError,
  startedAt: number,
): RuntimeIpcResult<never, TChannel> {
  return {
    ok: false,
    error,
    meta: {
      requestId,
      channel,
      handledAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    },
  };
}
