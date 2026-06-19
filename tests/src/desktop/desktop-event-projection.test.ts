// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { AppApi, AppEvent } from '../../../src/app';
import { registerChatStreamEventForwarder } from '../../../src/desktop/ipc/chat-stream-event-forwarder';
import { registerRuntimeEventForwarder } from '../../../src/desktop/ipc/runtime-event-forwarder';
import { mapAppEventToChatStreamEvent } from '../../../src/desktop/mappers/app-event-to-chat-stream-event.mapper';
import { mapAppEventToRuntimeEvent } from '../../../src/desktop/mappers/app-event-to-runtime-event.mapper';

function createAppEvent(type: string, payload: Record<string, unknown> = {}): AppEvent {
  return {
    type,
    occurredAt: '2026-06-19T00:00:00.000Z',
    source: 'agent',
    payload: {
      runId: 'run-1',
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      ...payload,
    },
  };
}

function createFakeAppApi(): AppApi & { emit(event: AppEvent): void } {
  const subscribers = new Set<(event: AppEvent) => void>();
  return {
    async startRun() {
      return { runId: 'run-1', status: 'running' };
    },
    async resumeRun() {
      return { runId: 'run-1', status: 'running' };
    },
    async cancelRun() {
      return { runId: 'run-1', status: 'cancelled' };
    },
    async retryRun() {
      return { runId: 'run-1', status: 'queued' };
    },
    subscribe(callback) {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },
    emit(event) {
      for (const subscriber of subscribers) subscriber(event);
    },
  };
}

function createFakeWindow() {
  return {
    webContents: {
      send: vi.fn(),
    },
  };
}

describe('desktop AppEvent projection', () => {
  it('maps run, ai, and tool AppEvents into renderer chat stream events', () => {
    expect(mapAppEventToChatStreamEvent(createAppEvent('ai.message.completed', { contentBlocks: 1 }))).toEqual({
      type: 'ai.message.completed',
      occurredAt: '2026-06-19T00:00:00.000Z',
      sessionId: 'session-1',
      runId: 'run-1',
      payload: {
        runId: 'run-1',
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        contentBlocks: 1,
      },
    });

    expect(mapAppEventToChatStreamEvent(createAppEvent('tool.execution.completed', { toolCallId: 'tool-1' }))).toEqual({
      type: 'tool.execution.completed',
      occurredAt: '2026-06-19T00:00:00.000Z',
      sessionId: 'session-1',
      runId: 'run-1',
      payload: {
        runId: 'run-1',
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        toolCallId: 'tool-1',
      },
    });
  });

  it('does not force app-wide events into chat stream projection', () => {
    expect(mapAppEventToChatStreamEvent(createAppEvent('approval.requested'))).toBeUndefined();
    expect(mapAppEventToChatStreamEvent(createAppEvent('workspace.changed'))).toBeUndefined();
  });

  it('maps every AppEvent into renderer runtime event without changing owner facts', () => {
    expect(mapAppEventToRuntimeEvent(createAppEvent('approval.requested', { approvalRequestId: 'approval-1' }))).toEqual({
      type: 'approval.requested',
      occurredAt: '2026-06-19T00:00:00.000Z',
      payload: {
        runId: 'run-1',
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        approvalRequestId: 'approval-1',
      },
    });
  });

  it('forwards mapped chat stream events to the renderer channel', () => {
    const appApi = createFakeAppApi();
    const window = createFakeWindow();

    const unsubscribe = registerChatStreamEventForwarder({
      appApi,
      getMainWindow: () => window as never,
    });
    appApi.emit(createAppEvent('ai.message.completed', { contentBlocks: 1 }));
    appApi.emit(createAppEvent('approval.requested', { approvalRequestId: 'approval-1' }));
    unsubscribe();

    expect(window.webContents.send).toHaveBeenCalledTimes(1);
    expect(window.webContents.send).toHaveBeenCalledWith('megumi:chat-stream:event', {
      type: 'ai.message.completed',
      occurredAt: '2026-06-19T00:00:00.000Z',
      sessionId: 'session-1',
      runId: 'run-1',
      payload: {
        runId: 'run-1',
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        contentBlocks: 1,
      },
    });
  });

  it('forwards runtime events to the renderer runtime channel', () => {
    const appApi = createFakeAppApi();
    const window = createFakeWindow();

    const unsubscribe = registerRuntimeEventForwarder({
      appApi,
      getMainWindow: () => window as never,
    });
    appApi.emit(createAppEvent('approval.requested', { approvalRequestId: 'approval-1' }));
    unsubscribe();

    expect(window.webContents.send).toHaveBeenCalledWith('megumi:runtime:event', {
      type: 'approval.requested',
      occurredAt: '2026-06-19T00:00:00.000Z',
      payload: {
        runId: 'run-1',
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        approvalRequestId: 'approval-1',
      },
    });
  });
});
