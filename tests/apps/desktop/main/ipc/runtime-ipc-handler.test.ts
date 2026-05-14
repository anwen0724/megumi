// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { RuntimeException } from '@megumi/core/runtime-exception';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import { createRuntimeIpcRequestSchema } from '@megumi/shared/ipc-contracts';
import { createRuntimeIpcHandler } from '@megumi/desktop/main/ipc/runtime-ipc-handler';

describe('createRuntimeIpcHandler', () => {
  const payloadSchema = z.object({ providerId: z.literal('deepseek') }).strict();
  const requestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.provider.list, payloadSchema);

  function createRequest() {
    return {
      requestId: 'ipc-provider-list-1',
      payload: { providerId: 'deepseek' },
      meta: {
        channel: IPC_CHANNELS.provider.list,
        createdAt: '2026-05-12T00:00:00.000Z',
        source: 'renderer',
      },
    };
  }

  function createContextRequest() {
    return {
      ...createRequest(),
      context: {
        requestId: 'ipc-provider-list-1',
        traceId: 'trace-provider-1',
        debugId: 'debug-provider-1',
        operationName: 'provider.list',
        source: 'renderer',
        createdAt: '2026-05-12T00:00:00.000Z',
      },
    };
  }

  function createLogger() {
    return {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  }

  it('returns a runtime ipc success envelope and preserves existing handler shape', async () => {
    const handler = createRuntimeIpcHandler({
      channel: IPC_CHANNELS.provider.list,
      requestSchema,
      handle: async (request) => ({
        providerId: request.payload.providerId,
      }),
    });

    const result = await handler({} as never, createRequest());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ providerId: 'deepseek' });
      expect(result.meta.requestId).toBe('ipc-provider-list-1');
      expect(result.meta.channel).toBe(IPC_CHANNELS.provider.list);
      expect(result.meta.handledAt).toEqual(expect.any(String));
      expect(result.meta.durationMs).toEqual(expect.any(Number));
      expect(result.meta.operationName).toBe('provider.list');
      expect(result.meta.traceId).toEqual(expect.stringMatching(/^trace-/));
    }
  });

  it('passes request runtime context to handlers and result metadata', async () => {
    const action = vi.fn(async (_request, _event, context) => ({
      traceId: context.traceId,
      debugId: context.debugId,
      operationName: context.operationName,
    }));
    const handler = createRuntimeIpcHandler({
      channel: IPC_CHANNELS.provider.list,
      requestSchema,
      handle: action,
      now: () => new Date('2026-05-12T00:00:01.000Z'),
      traceIdFactory: () => 'trace-main-unused',
      debugIdFactory: () => 'debug-main-unused',
    });

    const result = await handler({} as never, createContextRequest());

    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'ipc-provider-list-1' }),
      expect.anything(),
      {
        requestId: 'ipc-provider-list-1',
        traceId: 'trace-provider-1',
        debugId: 'debug-provider-1',
        operationName: 'provider.list',
        source: 'renderer',
        createdAt: '2026-05-12T00:00:00.000Z',
      },
    );
    expect(result).toEqual({
      ok: true,
      data: {
        traceId: 'trace-provider-1',
        debugId: 'debug-provider-1',
        operationName: 'provider.list',
      },
      meta: {
        requestId: 'ipc-provider-list-1',
        channel: IPC_CHANNELS.provider.list,
        traceId: 'trace-provider-1',
        debugId: 'debug-provider-1',
        operationName: 'provider.list',
        handledAt: '2026-05-12T00:00:01.000Z',
        durationMs: 0,
      },
    });
  });

  it('calculates duration from main-side handler timing instead of renderer request metadata', async () => {
    const now = vi
      .fn()
      .mockReturnValueOnce(new Date('2026-05-12T00:00:10.000Z'))
      .mockReturnValueOnce(new Date('2026-05-12T00:00:10.025Z'));
    const handler = createRuntimeIpcHandler({
      channel: IPC_CHANNELS.provider.list,
      requestSchema,
      handle: async () => ({
        providerId: 'deepseek',
      }),
      now,
    });

    const result = await handler({} as never, {
      ...createContextRequest(),
      meta: {
        channel: IPC_CHANNELS.provider.list,
        createdAt: '1999-01-01T00:00:00.000Z',
        source: 'renderer',
      },
    });

    expect(result).toMatchObject({
      ok: true,
      meta: {
        handledAt: '2026-05-12T00:00:10.025Z',
        durationMs: 25,
      },
    });
  });

  it('creates fallback runtime context when request context is missing', async () => {
    const action = vi.fn(async (_request, _event, context) => ({
      traceId: context.traceId,
      operationName: context.operationName,
      source: context.source,
    }));
    const handler = createRuntimeIpcHandler({
      channel: IPC_CHANNELS.provider.list,
      requestSchema,
      handle: action,
      now: () => new Date('2026-05-12T00:00:01.000Z'),
      traceIdFactory: () => 'trace-main-1',
      debugIdFactory: () => 'debug-main-1',
    });

    const result = await handler({} as never, createRequest());

    expect(action).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        requestId: 'ipc-provider-list-1',
        traceId: 'trace-main-1',
        operationName: 'provider.list',
        source: 'main',
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta).toMatchObject({
        requestId: 'ipc-provider-list-1',
        channel: IPC_CHANNELS.provider.list,
        traceId: 'trace-main-1',
        operationName: 'provider.list',
      });
      expect(result.meta.debugId).toBeUndefined();
    }
  });

  it('returns ipc_invalid_request with debug id and logs sanitized validation details', async () => {
    const logger = createLogger();
    const action = vi.fn();
    const handler = createRuntimeIpcHandler({
      channel: IPC_CHANNELS.provider.list,
      requestSchema,
      handle: action,
      logger,
      now: () => new Date('2026-05-12T00:00:01.000Z'),
      traceIdFactory: () => 'trace-main-1',
      debugIdFactory: () => 'debug-main-1',
    });

    const result = await handler({} as never, {
      requestId: 'bad id with spaces',
      payload: {
        providerId: 'openai',
        apiKey: 'sk-test-secret',
      },
      meta: {
        channel: IPC_CHANNELS.provider.list,
        createdAt: 'not-a-date',
        source: 'renderer',
      },
    });

    expect(action).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: 'ipc_invalid_request',
        message: 'Megumi received an invalid request.',
        severity: 'error',
        retryable: false,
        source: 'main',
        debugId: 'debug-main-1',
      });
      expect(result.error.details?.issueCount).toEqual(expect.any(Number));
      expect(result.meta).toMatchObject({
        requestId: 'invalid-request',
        channel: IPC_CHANNELS.provider.list,
        traceId: 'trace-main-1',
        debugId: 'debug-main-1',
        operationName: 'provider.list',
      });
    }
    expect(logger.warn).toHaveBeenCalledWith(
      'runtime.ipc.invalid_request',
      expect.objectContaining({
        channel: IPC_CHANNELS.provider.list,
        requestId: 'invalid-request',
        traceId: 'trace-main-1',
        debugId: 'debug-main-1',
        issueCount: expect.any(Number),
      }),
    );
    expect(JSON.stringify(result)).not.toContain('sk-test-secret');
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('sk-test-secret');
  });

  it('maps thrown RuntimeException without leaking cause or stack', async () => {
    const logger = createLogger();
    const handler = createRuntimeIpcHandler({
      channel: IPC_CHANNELS.provider.list,
      requestSchema,
      handle: async () => {
        throw new RuntimeException(
          {
            code: 'config_invalid',
            message: 'Megumi config is invalid. Fix C:/Users/anwen/.megumi/config.json and try again.',
            severity: 'error',
            retryable: false,
            source: 'config',
            debugId: 'debug-config-1',
            details: {
              configPath: 'C:/Users/anwen/.megumi/config.json',
            },
          },
          {
            cause: new Error('raw parser stack with sk-test-secret'),
          },
        );
      },
      logger,
      now: () => new Date('2026-05-12T00:00:01.000Z'),
      traceIdFactory: () => 'trace-main-1',
      debugIdFactory: () => 'debug-main-1',
    });

    const result = await handler({} as never, createRequest());

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'config_invalid',
        message: 'Megumi config is invalid. Fix C:/Users/anwen/.megumi/config.json and try again.',
        severity: 'error',
        retryable: false,
        source: 'config',
        debugId: 'debug-config-1',
        details: {
          configPath: 'C:/Users/anwen/.megumi/config.json',
        },
      },
      meta: {
        requestId: 'ipc-provider-list-1',
        channel: IPC_CHANNELS.provider.list,
        traceId: 'trace-main-1',
        debugId: 'debug-config-1',
        operationName: 'provider.list',
      },
    });
    expect(JSON.stringify(result)).not.toContain('raw parser stack');
    expect(JSON.stringify(result)).not.toContain('sk-test-secret');
    expect(logger.error).toHaveBeenCalledWith(
      'runtime.ipc.handler_failed',
      expect.objectContaining({
        channel: IPC_CHANNELS.provider.list,
        requestId: 'ipc-provider-list-1',
        traceId: 'trace-main-1',
        debugId: 'debug-config-1',
        errorCode: 'config_invalid',
      }),
    );
  });

  it('normalizes unknown handler errors and redacts logger details', async () => {
    const logger = createLogger();
    const handler = createRuntimeIpcHandler({
      channel: IPC_CHANNELS.provider.list,
      requestSchema,
      handle: async () => {
        throw new Error('Provider settings write failed with apiKey=sk-test-secret');
      },
      logger,
      now: () => new Date('2026-05-12T00:00:01.000Z'),
      traceIdFactory: () => 'trace-main-1',
      debugIdFactory: () => 'debug-main-1',
    });

    const result = await handler({} as never, createRequest());

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'runtime_unknown',
        message: 'Unexpected runtime error.',
        severity: 'error',
        retryable: true,
        source: 'main',
        debugId: 'debug-main-1',
      },
      meta: {
        requestId: 'ipc-provider-list-1',
        channel: IPC_CHANNELS.provider.list,
        traceId: 'trace-main-1',
        debugId: 'debug-main-1',
        operationName: 'provider.list',
      },
    });
    expect(JSON.stringify(result)).not.toContain('Provider settings write failed');
    expect(JSON.stringify(result)).not.toContain('sk-test-secret');
    expect(logger.error).toHaveBeenCalledWith(
      'runtime.ipc.handler_failed',
      expect.objectContaining({
        message: 'Provider settings write failed with apiKey=[redacted]',
        debugId: 'debug-main-1',
      }),
    );
  });

  it('maps thrown errors with a custom mapper and passes context to the mapper', async () => {
    const mapError = vi.fn(() => ({
      code: 'ipc_handler_failed' as const,
      message: 'Provider settings request failed.',
      severity: 'error' as const,
      retryable: true,
      source: 'main' as const,
    }));
    const handler = createRuntimeIpcHandler({
      channel: IPC_CHANNELS.provider.list,
      requestSchema,
      handle: async () => {
        throw new Error('Provider settings write failed.');
      },
      mapError,
      now: () => new Date('2026-05-12T00:00:01.000Z'),
      traceIdFactory: () => 'trace-main-1',
      debugIdFactory: () => 'debug-main-1',
    });

    const result = await handler({} as never, createContextRequest());

    expect(mapError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ requestId: 'ipc-provider-list-1' }),
      expect.objectContaining({
        traceId: 'trace-provider-1',
        debugId: 'debug-provider-1',
        operationName: 'provider.list',
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'ipc_handler_failed',
        message: 'Provider settings request failed.',
        severity: 'error',
        retryable: true,
        source: 'main',
        debugId: 'debug-provider-1',
      },
      meta: {
        requestId: 'ipc-provider-list-1',
        channel: IPC_CHANNELS.provider.list,
        traceId: 'trace-provider-1',
        debugId: 'debug-provider-1',
        operationName: 'provider.list',
      },
    });
    expect(JSON.stringify(result)).not.toContain('Provider settings write failed.');
    expect(JSON.stringify(result)).not.toContain('stack');
  });
});
