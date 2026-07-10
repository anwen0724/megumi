import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { IPC_CHANNELS } from '@megumi/desktop/main/ipc/channels';
import { createRuntimeIpcRequestSchema, createRuntimeIpcResultSchema } from '@megumi/desktop/main/ipc/contracts';
import { createIpcRequestHandler } from '@megumi/desktop/main/ipc/create-request-handler';

const requestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.chat.sessionList,
  z.object({}).strict(),
);
const request = {
  requestId: 'request-1',
  payload: {},
  meta: {
    channel: IPC_CHANNELS.chat.sessionList,
    createdAt: '2026-07-10T01:00:00.000Z',
    source: 'renderer',
  },
};

describe('createIpcRequestHandler response validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps strict response validation by default', async () => {
    const handler = createIpcRequestHandler({
      channel: IPC_CHANNELS.chat.sessionList,
      requestSchema,
      responseSchema: z.object({ okValue: z.string() }).strict(),
      handle: () => ({ okValue: 1 }) as never,
    });

    const result = await handler({} as never, request);

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      ok: false,
      data: {
        code: 'ipc_handler_failed',
        message: 'IPC handler failed.',
      },
    });
    expect(result).not.toHaveProperty('error');
  });

  it('can skip response validation for explicitly selected large payload handlers', async () => {
    const handler = createIpcRequestHandler({
      channel: IPC_CHANNELS.chat.sessionList,
      requestSchema,
      responseSchema: z.object({ okValue: z.string() }).strict(),
      responseValidation: 'off',
      handle: () => ({ okValue: 1 }) as never,
    });

    const result = await handler({} as never, request);

    expect(result).toMatchObject({
      ok: true,
      data: { okValue: 1 },
    });
  });

  it('skips dev-only response validation in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const handler = createIpcRequestHandler({
      channel: IPC_CHANNELS.chat.sessionList,
      requestSchema,
      responseSchema: z.object({ okValue: z.string() }).strict(),
      responseValidation: 'dev-only',
      handle: () => ({ okValue: 1 }) as never,
    });

    const result = await handler({} as never, request);

    expect(result).toMatchObject({
      ok: true,
      data: { okValue: 1 },
    });
  });

  it('validates IPC failures through the data field instead of error', () => {
    const resultSchema = createRuntimeIpcResultSchema(
      z.object({ okValue: z.string() }).strict(),
      IPC_CHANNELS.chat.sessionList,
    );
    const meta = {
      requestId: 'request-1',
      channel: IPC_CHANNELS.chat.sessionList,
      handledAt: '2026-07-10T01:00:00.000Z',
      durationMs: 1,
    };

    expect(resultSchema.safeParse({
      ok: false,
      data: {
        code: 'ipc_invalid_request',
        message: 'IPC request payload is invalid.',
        severity: 'error',
        retryable: false,
        source: 'main',
      },
      meta,
    }).success).toBe(true);
    expect(resultSchema.safeParse({
      ok: false,
      error: {
        code: 'ipc_invalid_request',
        message: 'IPC request payload is invalid.',
        severity: 'error',
        retryable: false,
        source: 'main',
      },
      meta,
    }).success).toBe(false);
  });
});
