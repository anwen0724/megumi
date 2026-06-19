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
  it('maps ai.message.event text deltas into renderer assistant.text.delta events', () => {
    expect(mapAppEventToChatStreamEvent(createAppEvent('ai.message.event', {
      seq: 7,
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'hello' },
      },
    }))).toEqual(expect.objectContaining({
      eventType: 'assistant.text.delta',
      projectId: 'workspace-1',
      sessionId: 'session-1',
      runId: 'run-1',
      streamId: 'chat-stream:run-1',
      streamKind: 'main',
      seq: 7,
      createdAt: '2026-06-19T00:00:00.000Z',
      textId: 'assistant-text:run-1:answer:0',
      phase: 'answer',
      delta: 'hello',
    }));
  });

  it('falls back to a renderer project id when AppEvent has no project id', () => {
    expect(mapAppEventToChatStreamEvent(createAppEvent('turn.started', {
      workspaceId: undefined,
      seq: 1,
    }))).toEqual(expect.objectContaining({
      eventType: 'turn.started',
      projectId: 'default-project',
    }));
  });

  it('maps run and tool AppEvents into renderer chat stream protocol events', () => {
    expect(mapAppEventToChatStreamEvent(createAppEvent('ai.message.completed', { seq: 3 }))).toEqual(expect.objectContaining({
      eventType: 'assistant.text.completed',
      projectId: 'workspace-1',
      sessionId: 'session-1',
      runId: 'run-1',
      streamId: 'chat-stream:run-1',
      streamKind: 'main',
      seq: 3,
      textId: 'assistant-text:run-1:answer:0',
      phase: 'answer',
    }));

    expect(mapAppEventToChatStreamEvent(createAppEvent('tool.execution.completed', {
      seq: 4,
      toolCallId: 'tool-1',
      toolExecutionId: 'tool-execution-1',
      toolName: 'read_file',
      status: 'succeeded',
    }))).toEqual(expect.objectContaining({
      eventType: 'tool.completed',
      toolCallId: 'tool-1',
      toolExecutionId: 'tool-execution-1',
      toolName: 'read_file',
      seq: 4,
    }));

    expect(mapAppEventToChatStreamEvent(createAppEvent('run.status.changed', {
      seq: 5,
      status: 'failed',
      error: { message: 'boom' },
    }))).toEqual(expect.objectContaining({
      eventType: 'turn.failed',
      errorMessage: 'boom',
      seq: 5,
    }));
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

  it('forwards mapped chat stream events to the renderer channel with eventType protocol payloads', () => {
    const appApi = createFakeAppApi();
    const window = createFakeWindow();

    const unsubscribe = registerChatStreamEventForwarder({
      appApi,
      getMainWindow: () => window as never,
    });
    appApi.emit(createAppEvent('ai.message.event', {
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'pong' },
      },
    }));
    appApi.emit(createAppEvent('approval.requested', { approvalRequestId: 'approval-1' }));
    appApi.emit(createAppEvent('ai.message.event', {
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'pong again' },
      },
    }));
    unsubscribe();

    expect(window.webContents.send).toHaveBeenCalledTimes(2);
    expect(window.webContents.send).toHaveBeenCalledWith('megumi:chat-stream:event', expect.objectContaining({
      eventType: 'assistant.text.delta',
      delta: 'pong',
      seq: 1,
    }));
    expect(window.webContents.send).toHaveBeenCalledWith('megumi:chat-stream:event', expect.objectContaining({
      eventType: 'assistant.text.delta',
      delta: 'pong again',
      seq: 2,
    }));
    expect(window.webContents.send.mock.calls[0][1]).not.toHaveProperty('type');
    expect(window.webContents.send.mock.calls[1][1]).not.toHaveProperty('type');
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
