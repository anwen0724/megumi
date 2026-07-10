import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { IPC_CHANNELS } from '@megumi/desktop/main/ipc/channels';
import { createRuntimeIpcRequestSchema } from '@megumi/desktop/main/ipc/contracts';
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
});
