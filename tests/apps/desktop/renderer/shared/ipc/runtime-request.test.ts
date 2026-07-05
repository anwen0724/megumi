// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc';
import {
  createRendererRuntimeIpcRequest,
} from '@megumi/desktop/renderer/shared/ipc/runtime-request';
import {
  rendererRuntimeOperationNameFromChannel,
} from '@megumi/desktop/renderer/shared/ipc/runtime-operation-name';

describe('createRendererRuntimeIpcRequest', () => {
  it('creates a business ipc request envelope with RuntimeContext', () => {
    vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-05-12T00:00:00.000Z');
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      'trace-renderer-uuid-1' as `${string}-${string}-${string}-${string}-${string}`,
    );

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

  it('accepts explicit request id and trace id for session message correlation', () => {
    const request = createRendererRuntimeIpcRequest(
      IPC_CHANNELS.session.message.send,
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
        requestId: 'ipc-session-message-send-1',
        traceId: 'trace-session-message-run-1',
        createdAt: '2026-05-12T00:00:00.000Z',
      },
    );

    expect(request.requestId).toBe('ipc-session-message-send-1');
    expect(request.meta.channel).toBe(IPC_CHANNELS.session.message.send);
    expect(request.context).toEqual({
      requestId: 'ipc-session-message-send-1',
      traceId: 'trace-session-message-run-1',
      operationName: 'session.message.send',
      source: 'renderer',
      createdAt: '2026-05-12T00:00:00.000Z',
    });
  });

  it('allows debug id only when caller explicitly provides it', () => {
    const request = createRendererRuntimeIpcRequest(
      IPC_CHANNELS.session.message.cancel,
      {
        targetRequestId: 'ipc-session-message-send-1',
      },
      {
        requestId: 'ipc-session-message-cancel-1',
        traceId: 'trace-session-message-run-1',
        debugId: 'debug-renderer-cancel-1',
        createdAt: '2026-05-12T00:00:00.000Z',
      },
    );

    expect(request.context).toEqual({
      requestId: 'ipc-session-message-cancel-1',
      traceId: 'trace-session-message-run-1',
      debugId: 'debug-renderer-cancel-1',
      operationName: 'session.message.cancel',
      source: 'renderer',
      createdAt: '2026-05-12T00:00:00.000Z',
    });
  });

  it('maps current business IPC channels to stable operation names', () => {
    expect(rendererRuntimeOperationNameFromChannel(IPC_CHANNELS.provider.list)).toBe('provider.list');
    expect(rendererRuntimeOperationNameFromChannel(IPC_CHANNELS.provider.update)).toBe('provider.update');
    expect(rendererRuntimeOperationNameFromChannel(IPC_CHANNELS.provider.setApiKey)).toBe('provider.set-api-key');
    expect(rendererRuntimeOperationNameFromChannel(IPC_CHANNELS.provider.deleteApiKey)).toBe('provider.delete-api-key');
    expect(rendererRuntimeOperationNameFromChannel(IPC_CHANNELS.session.create)).toBe('session.create');
    expect(rendererRuntimeOperationNameFromChannel(IPC_CHANNELS.session.list)).toBe('session.list');
    expect(rendererRuntimeOperationNameFromChannel(IPC_CHANNELS.session.message.send)).toBe('session.message.send');
    expect(rendererRuntimeOperationNameFromChannel(IPC_CHANNELS.session.message.cancel)).toBe('session.message.cancel');
    expect(rendererRuntimeOperationNameFromChannel(IPC_CHANNELS.run.events.list)).toBe('run.events.list');
    expect(rendererRuntimeOperationNameFromChannel(IPC_CHANNELS.runContext.baselineGet)).toBe('run-context.baseline.get');
    expect(rendererRuntimeOperationNameFromChannel(IPC_CHANNELS.runContext.sourcesList)).toBe('run-context.sources.list');
    expect(rendererRuntimeOperationNameFromChannel(IPC_CHANNELS.plan.byRunGet)).toBe('plan.by-run.get');
    expect(rendererRuntimeOperationNameFromChannel(IPC_CHANNELS.tool.definitionsList)).toBe('tool.definitions.list');
    expect(rendererRuntimeOperationNameFromChannel(IPC_CHANNELS.approval.resolve)).toBe('approval.resolve');
    expect(rendererRuntimeOperationNameFromChannel(IPC_CHANNELS.artifacts.get)).toBe('artifacts.get');
    expect(rendererRuntimeOperationNameFromChannel(IPC_CHANNELS.artifacts.listByRun)).toBe('artifacts.list-by-run');
    expect(rendererRuntimeOperationNameFromChannel(IPC_CHANNELS.artifacts.listBySession)).toBe('artifacts.list-by-session');
    expect(rendererRuntimeOperationNameFromChannel(IPC_CHANNELS.artifacts.versionGet)).toBe('artifacts.version.get');
    expect(rendererRuntimeOperationNameFromChannel(IPC_CHANNELS.artifacts.versionCreate)).toBe('artifacts.version.create');
    expect(rendererRuntimeOperationNameFromChannel(IPC_CHANNELS.artifacts.statusUpdate)).toBe('artifacts.status.update');
    expect(rendererRuntimeOperationNameFromChannel(IPC_CHANNELS.artifacts.reference)).toBe('artifacts.reference');
    expect(rendererRuntimeOperationNameFromChannel(IPC_CHANNELS.workspace.files.list)).toBe('workspace.files.list');
  });
});

