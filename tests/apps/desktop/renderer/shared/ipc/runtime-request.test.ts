// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import { createRendererRuntimeIpcRequest } from '@megumi/desktop/renderer/shared/ipc/runtime-request';

describe('createRendererRuntimeIpcRequest', () => {
  it('creates a business ipc request envelope', () => {
    vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-05-12T00:00:00.000Z');

    const request = createRendererRuntimeIpcRequest(IPC_CHANNELS.provider.update, {
      providerId: 'deepseek',
      enabled: false,
    });

    expect(request).toMatchObject({
      payload: {
        providerId: 'deepseek',
        enabled: false,
      },
      meta: {
        channel: IPC_CHANNELS.provider.update,
        createdAt: '2026-05-12T00:00:00.000Z',
        source: 'renderer',
      },
    });
    expect(request.requestId).toMatch(/^ipc-/);
  });

  it('accepts an explicit request id for chat runtime correlation', () => {
    const request = createRendererRuntimeIpcRequest(
      IPC_CHANNELS.chat.start,
      {
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        createdAt: '2026-05-12T00:00:00.000Z',
        messages: [
          {
            id: 'message-1',
            role: 'user' as const,
            content: 'Hello',
            createdAt: '2026-05-12T00:00:00.000Z',
          },
        ],
      },
      { requestId: 'ipc-chat-start-1' },
    );

    expect(request.requestId).toBe('ipc-chat-start-1');
    expect(request.meta.channel).toBe(IPC_CHANNELS.chat.start);
  });
});
