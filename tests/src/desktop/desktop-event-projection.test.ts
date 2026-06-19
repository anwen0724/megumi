// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { AgentRuntimeEvent, AgentRuntimePort } from '../../../src/app';
import { registerChatStreamEventForwarder } from '../../../src/desktop/ipc/chat-stream-event-forwarder';
import { registerRuntimeEventForwarder } from '../../../src/desktop/ipc/runtime-event-forwarder';
import { mapAgentRuntimeEventToChatStreamEvent } from '../../../src/desktop/mappers/agent-runtime-event-to-chat-stream-event.mapper';
import { mapAgentRuntimeEventToRendererRuntimeEvent } from '../../../src/desktop/mappers/agent-runtime-event-to-renderer-runtime-event.mapper';

function createAgentRuntimeEvent(type: string, input: {
  runId?: string;
  sessionId?: string;
  workspaceId?: string;
  payload?: Record<string, unknown>;
} = {}): AgentRuntimeEvent {
  return {
    type,
    occurredAt: '2026-06-19T00:00:00.000Z',
    runId: input.runId ?? 'run-1',
    sessionId: input.sessionId ?? 'session-1',
    ...('workspaceId' in input ? { workspaceId: input.workspaceId } : { workspaceId: 'workspace-1' }),
    payload: {
      ...(input.payload ?? {}),
    },
  };
}

function createFakeAgentRuntime(): AgentRuntimePort & { emit(event: AgentRuntimeEvent): void } {
  const subscribers = new Set<(event: AgentRuntimeEvent) => void>();
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

describe('desktop AgentRuntimeEvent projection', () => {
  it('maps ai.message.event text deltas into renderer assistant.text.delta events', () => {
    expect(mapAgentRuntimeEventToChatStreamEvent(createAgentRuntimeEvent('ai.message.event', {
      payload: {
        seq: 7,
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'hello' },
        },
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

  it('falls back to a renderer project id when AgentRuntimeEvent has no project id', () => {
    expect(mapAgentRuntimeEventToChatStreamEvent(createAgentRuntimeEvent('turn.started', {
      workspaceId: undefined,
      payload: { seq: 1 },
    }))).toEqual(expect.objectContaining({
      eventType: 'turn.started',
      projectId: 'default-project',
    }));
  });

  it('maps run and tool AgentRuntimeEvents into renderer chat stream protocol events', () => {
    expect(mapAgentRuntimeEventToChatStreamEvent(createAgentRuntimeEvent('ai.message.completed', {
      payload: { seq: 3 },
    }))).toEqual(expect.objectContaining({
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

    expect(mapAgentRuntimeEventToChatStreamEvent(createAgentRuntimeEvent('tool.execution.completed', {
      payload: {
        seq: 4,
        toolCallId: 'tool-1',
        toolExecutionId: 'tool-execution-1',
        toolName: 'read_file',
        status: 'succeeded',
      },
    }))).toEqual(expect.objectContaining({
      eventType: 'tool.completed',
      toolCallId: 'tool-1',
      toolExecutionId: 'tool-execution-1',
      toolName: 'read_file',
      seq: 4,
    }));

    expect(mapAgentRuntimeEventToChatStreamEvent(createAgentRuntimeEvent('run.status.changed', {
      payload: {
        seq: 5,
        status: 'failed',
        error: { message: 'boom' },
      },
    }))).toEqual(expect.objectContaining({
      eventType: 'turn.failed',
      errorMessage: 'boom',
      seq: 5,
    }));
  });

  it('does not force app-wide events into chat stream projection', () => {
    expect(mapAgentRuntimeEventToChatStreamEvent(createAgentRuntimeEvent('approval.requested'))).toBeUndefined();
    expect(mapAgentRuntimeEventToChatStreamEvent(createAgentRuntimeEvent('workspace.changed'))).toBeUndefined();
  });

  it('maps every AgentRuntimeEvent into renderer runtime event without changing owner facts', () => {
    expect(mapAgentRuntimeEventToRendererRuntimeEvent(createAgentRuntimeEvent('approval.requested', {
      payload: { approvalRequestId: 'approval-1' },
    }))).toEqual({
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
    const agentRuntime = createFakeAgentRuntime();
    const window = createFakeWindow();

    const unsubscribe = registerChatStreamEventForwarder({
      agentRuntime,
      getMainWindow: () => window as never,
    });
    agentRuntime.emit(createAgentRuntimeEvent('ai.message.event', {
      payload: {
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'pong' },
        },
      },
    }));
    agentRuntime.emit(createAgentRuntimeEvent('approval.requested', {
      payload: { approvalRequestId: 'approval-1' },
    }));
    agentRuntime.emit(createAgentRuntimeEvent('ai.message.event', {
      payload: {
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'pong again' },
        },
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
    const agentRuntime = createFakeAgentRuntime();
    const window = createFakeWindow();

    const unsubscribe = registerRuntimeEventForwarder({
      agentRuntime,
      getMainWindow: () => window as never,
    });
    agentRuntime.emit(createAgentRuntimeEvent('approval.requested', {
      payload: { approvalRequestId: 'approval-1' },
    }));
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
