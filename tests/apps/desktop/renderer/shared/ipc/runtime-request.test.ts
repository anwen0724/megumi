// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import {
  createRendererRuntimeIpcRequest,
} from '@megumi/desktop/renderer/shared/ipc/runtime-request';
import {
  rendererRuntimeOperationNameFromChannel,
} from '@megumi/desktop/renderer/shared/ipc/runtime-operation-name';

describe('createRendererRuntimeIpcRequest', () => {
  it('creates a business ipc request envelope with RuntimeContext', () => {
    vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-05-12T00:00:00.000Z');
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('trace-renderer-uuid-1');

    const request = createRendererRuntimeIpcRequest(IPC_CHANNELS.provider.update, {
      providerId: 'deepseek',
      enabled: false,
    });

    expect(request).toMatchObject({
      requestId: 'ipc-trace-renderer-uuid-1',
      payload: {
        providerId: 'deepseek',
        enabled: false,
      },
      meta: {
        channel: IPC_CHANNELS.provider.update,
        createdAt: '2026-05-12T00:00:00.000Z',
        source: 'renderer',
      },
      context: {
        requestId: 'ipc-trace-renderer-uuid-1',
        traceId: 'trace-trace-renderer-uuid-1',
        operationName: 'provider.update',
        source: 'renderer',
        createdAt: '2026-05-12T00:00:00.000Z',
      },
    });
  });

  it('accepts explicit request id and trace id for chat runtime correlation', () => {
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
      {
        requestId: 'ipc-chat-start-1',
        traceId: 'trace-chat-run-1',
        createdAt: '2026-05-12T00:00:00.000Z',
      },
    );

    expect(request.requestId).toBe('ipc-chat-start-1');
    expect(request.meta.channel).toBe(IPC_CHANNELS.chat.start);
    expect(request.context).toEqual({
      requestId: 'ipc-chat-start-1',
      traceId: 'trace-chat-run-1',
      operationName: 'chat.start',
      source: 'renderer',
      createdAt: '2026-05-12T00:00:00.000Z',
    });
  });

  it('allows debug id only when caller explicitly provides it', () => {
    const request = createRendererRuntimeIpcRequest(
      IPC_CHANNELS.chat.cancel,
      {
        targetRequestId: 'ipc-chat-start-1',
      },
      {
        requestId: 'ipc-chat-cancel-1',
        traceId: 'trace-chat-run-1',
        debugId: 'debug-renderer-cancel-1',
        createdAt: '2026-05-12T00:00:00.000Z',
      },
    );

    expect(request.context).toEqual({
      requestId: 'ipc-chat-cancel-1',
      traceId: 'trace-chat-run-1',
      debugId: 'debug-renderer-cancel-1',
      operationName: 'chat.cancel',
      source: 'renderer',
      createdAt: '2026-05-12T00:00:00.000Z',
    });
  });

  it('maps current business IPC channels to stable operation names', () => {
    expect(rendererRuntimeOperationNameFromChannel(IPC_CHANNELS.provider.list)).toBe('provider.list');
    expect(rendererRuntimeOperationNameFromChannel(IPC_CHANNELS.provider.update)).toBe('provider.update');
    expect(rendererRuntimeOperationNameFromChannel(IPC_CHANNELS.provider.setApiKey)).toBe('provider.set-api-key');
    expect(rendererRuntimeOperationNameFromChannel(IPC_CHANNELS.provider.deleteApiKey)).toBe('provider.delete-api-key');
    expect(rendererRuntimeOperationNameFromChannel(IPC_CHANNELS.chat.start)).toBe('chat.start');
    expect(rendererRuntimeOperationNameFromChannel(IPC_CHANNELS.chat.cancel)).toBe('chat.cancel');
  });
});
