// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import { createRuntimeIpcRequestSchema } from '@megumi/shared/ipc-contracts';
import { createRuntimeIpcHandler } from '@megumi/desktop/main/ipc/runtime-ipc-handler';

describe('createRuntimeIpcHandler', () => {
  const payloadSchema = z.object({ providerId: z.literal('deepseek') }).strict();
  const requestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.provider.list, payloadSchema);

  it('returns a runtime ipc success envelope', async () => {
    const handler = createRuntimeIpcHandler({
      channel: IPC_CHANNELS.provider.list,
      requestSchema,
      handle: async (request) => ({
        providerId: request.payload.providerId,
      }),
    });

    const result = await handler({} as never, {
      requestId: 'ipc-provider-list-1',
      payload: { providerId: 'deepseek' },
      meta: {
        channel: IPC_CHANNELS.provider.list,
        createdAt: '2026-05-12T00:00:00.000Z',
        source: 'renderer',
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ providerId: 'deepseek' });
      expect(result.meta.requestId).toBe('ipc-provider-list-1');
      expect(result.meta.channel).toBe(IPC_CHANNELS.provider.list);
      expect(result.meta.handledAt).toEqual(expect.any(String));
      expect(result.meta.durationMs).toEqual(expect.any(Number));
    }
  });

  it('returns ipc_invalid_request for invalid request payloads', async () => {
    const action = vi.fn();
    const handler = createRuntimeIpcHandler({
      channel: IPC_CHANNELS.provider.list,
      requestSchema,
      handle: action,
    });

    const result = await handler({} as never, {
      requestId: 'bad id with spaces',
      payload: { providerId: 'openai' },
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
      });
      expect(result.error.details?.issueCount).toEqual(expect.any(Number));
      expect(result.meta.requestId).toBe('invalid-request');
    }
  });

  it('maps thrown errors with a custom mapper', async () => {
    const handler = createRuntimeIpcHandler({
      channel: IPC_CHANNELS.provider.list,
      requestSchema,
      handle: async () => {
        throw new Error('Provider settings write failed.');
      },
      mapError: () => ({
        code: 'ipc_handler_failed',
        message: 'Provider settings request failed.',
        severity: 'error',
        retryable: true,
        source: 'main',
      }),
    });

    const result = await handler({} as never, {
      requestId: 'ipc-provider-list-1',
      payload: { providerId: 'deepseek' },
      meta: {
        channel: IPC_CHANNELS.provider.list,
        createdAt: '2026-05-12T00:00:00.000Z',
        source: 'renderer',
      },
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'ipc_handler_failed',
        message: 'Provider settings request failed.',
        severity: 'error',
        retryable: true,
        source: 'main',
      },
      meta: {
        requestId: 'ipc-provider-list-1',
        channel: IPC_CHANNELS.provider.list,
      },
    });
    expect(JSON.stringify(result)).not.toContain('Provider settings write failed.');
    expect(JSON.stringify(result)).not.toContain('stack');
  });
});
