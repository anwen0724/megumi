import type { IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import type { JsonObject } from '@megumi/shared/json';
import type { BusinessIpcChannel, RuntimeIpcRequest, RuntimeIpcResult } from '@megumi/shared/ipc-contracts';
import { RuntimeIpcRequestIdSchema } from '@megumi/shared/ipc-contracts';
import type { RuntimeIpcError } from '@megumi/shared/ipc-errors';
import { sanitizeZodIssues } from '@megumi/shared/ipc-errors';

export interface RuntimeIpcHandlerOptions<
  TPayload,
  TData extends object,
  TChannel extends BusinessIpcChannel,
  TRequest extends RuntimeIpcRequest<TPayload, TChannel> = RuntimeIpcRequest<TPayload, TChannel>,
> {
  channel: TChannel;
  requestSchema: z.ZodType<TRequest>;
  handle: (request: TRequest, event: IpcMainInvokeEvent) => Promise<TData> | TData;
  mapError?: (error: unknown, request: TRequest) => RuntimeIpcError;
}

export function createRuntimeIpcHandler<
  TPayload,
  TData extends object,
  TChannel extends BusinessIpcChannel,
  TRequest extends RuntimeIpcRequest<TPayload, TChannel> = RuntimeIpcRequest<TPayload, TChannel>,
>(options: RuntimeIpcHandlerOptions<TPayload, TData, TChannel, TRequest>) {
  return async (
    event: IpcMainInvokeEvent,
    rawRequest: unknown,
  ): Promise<RuntimeIpcResult<TData, TChannel>> => {
    const startedAt = Date.now();
    const parsed = options.requestSchema.safeParse(rawRequest);

    if (!parsed.success) {
      return createFailureResult({
        channel: options.channel,
        requestId: extractRequestId(rawRequest),
        startedAt,
        error: {
          code: 'ipc_invalid_request',
          message: 'Megumi received an invalid request.',
          severity: 'error',
          retryable: false,
          source: 'main',
          details: sanitizeZodIssues(parsed.error) as unknown as JsonObject,
        },
      });
    }

    try {
      const data = await options.handle(parsed.data, event);

      return {
        ok: true,
        data,
        meta: {
          requestId: parsed.data.requestId,
          channel: options.channel,
          handledAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
        },
      };
    } catch (error) {
      const mapped = options.mapError
        ? options.mapError(error, parsed.data)
        : createUnknownMainError();

      return createFailureResult({
        channel: options.channel,
        requestId: parsed.data.requestId,
        startedAt,
        error: mapped,
      });
    }
  };
}

function createFailureResult<TChannel extends BusinessIpcChannel>(input: {
  channel: TChannel;
  requestId: string;
  startedAt: number;
  error: RuntimeIpcError;
}) {
  return {
    ok: false as const,
    error: input.error,
    meta: {
      requestId: input.requestId,
      channel: input.channel,
      handledAt: new Date().toISOString(),
      durationMs: Date.now() - input.startedAt,
    },
  };
}

function createUnknownMainError(): RuntimeIpcError {
  return {
    code: 'ipc_handler_failed',
    message: 'Megumi could not complete that request.',
    severity: 'error',
    retryable: true,
    source: 'main',
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
