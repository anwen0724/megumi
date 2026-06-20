// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { AgentRuntimeEvent, AgentRuntimePort } from '../../../src/app';
import { registerChatStreamEventForwarder } from '../../../src/desktop/ipc/events/chat-stream-event-forwarder';
import { registerRuntimeEventForwarder } from '../../../src/desktop/ipc/events/runtime-event-forwarder';
import { createAgentRuntimeChatStreamAdapter } from '../../../src/desktop/renderer-protocol/agent-runtime-chat-stream-adapter';
import { mapAgentRuntimeEventToChatStreamEvent } from '../../../src/desktop/renderer-protocol/agent-runtime-event-to-chat-stream-event.mapper';
import { mapAgentRuntimeEventToRendererRuntimeEvent } from '../../../src/desktop/renderer-protocol/agent-runtime-event-to-renderer-runtime-event.mapper';
import type { RendererChatStreamEventDto } from '../../../src/shared/renderer-contracts';

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

const approvalRequest = {
  id: 'approval-1',
  runId: 'run-1',
  sessionId: 'session-1',
  toolCallId: 'tool-call-1',
  status: 'pending',
  decisionKind: 'ask',
  requestedScope: 'once',
  createdAt: '2026-06-19T00:00:00.000Z',
  policyDecision: {
    id: 'permission-decision-1',
    kind: 'ask',
    reason: 'write_requires_approval',
    mode: 'default',
    operation: 'write',
    actionName: 'write_file',
    target: 'src/a.ts',
    risk: { level: 'sensitive', reasons: ['write_file'] },
    createdAt: '2026-06-19T00:00:00.000Z',
  },
};

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

  it('maps AgentRuntimeEvents into renderer runtime events consumed by the migrated UI', () => {
    expect(mapAgentRuntimeEventToRendererRuntimeEvent(createAgentRuntimeEvent('approval.requested', {
      payload: { approvalRequestId: 'approval-1', toolCallId: 'tool-call-1', approvalRequest },
    }), { sequence: 7 })).toEqual(expect.objectContaining({
      eventId: 'runtime-event:run-1:7',
      eventType: 'approval.requested',
      projectId: 'workspace-1',
      runId: 'run-1',
      sessionId: 'session-1',
      sequence: 7,
      createdAt: '2026-06-19T00:00:00.000Z',
      payload: {
        approvalRequest: expect.objectContaining({
          approvalRequestId: 'approval-1',
          toolCallId: 'tool-call-1',
          toolName: 'write_file',
        }),
      },
    }));

    expect(mapAgentRuntimeEventToRendererRuntimeEvent(createAgentRuntimeEvent('context.ready', {
      payload: { included: 3, dropped: 1 },
    }), { sequence: 8 })).toEqual(expect.objectContaining({
      eventId: 'runtime-event:run-1:8',
      eventType: 'context.effective.updated',
      runId: 'run-1',
      sessionId: 'session-1',
      sequence: 8,
      payload: expect.objectContaining({
        workspaceId: 'workspace-1',
        sourceCount: 3,
        droppedCount: 1,
      }),
    }));

    expect(mapAgentRuntimeEventToRendererRuntimeEvent(createAgentRuntimeEvent('run.status.changed', {
      payload: { status: 'completed', requestId: 'ipc-session-message-send-1' },
    }), { sequence: 9 })).toEqual(expect.objectContaining({
      eventType: 'run.completed',
      requestId: 'ipc-session-message-send-1',
      sequence: 9,
      payload: expect.objectContaining({
        requestId: 'ipc-session-message-send-1',
        to: 'completed',
      }),
    }));
  });

  it('commits the renderer user message once for a multi-turn Agent Run', () => {
    const events: RendererChatStreamEventDto[] = [];
    const adapter = createAgentRuntimeChatStreamAdapter({ publish: (event) => events.push(event) });

    adapter.handle(createAgentRuntimeEvent('turn.started', {
      payload: {
        turnIndex: 0,
        userMessageId: 'message-user-1',
        clientMessageId: 'client-message-1',
        userMessageText: 'hello',
      },
    }));
    adapter.handle(createAgentRuntimeEvent('turn.started', {
      payload: {
        turnIndex: 1,
        userMessageId: 'message-user-1',
        clientMessageId: 'client-message-1',
        userMessageText: 'hello',
      },
    }));

    expect(events.filter((event) => event.eventType === 'turn.started')).toHaveLength(2);
    expect(events.filter((event) => event.eventType === 'user.message.committed')).toEqual([
      expect.objectContaining({
        messageId: 'message-user-1',
        clientMessageId: 'client-message-1',
        text: 'hello',
      }),
    ]);
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

    expect(window.webContents.send).toHaveBeenCalledTimes(4);
    expect(window.webContents.send).toHaveBeenCalledWith('megumi:chat-stream:event', expect.objectContaining({
      eventType: 'assistant.text.delta',
      delta: 'pong',
      seq: 2,
    }));
    expect(window.webContents.send).toHaveBeenCalledWith('megumi:chat-stream:event', expect.objectContaining({
      eventType: 'assistant.text.delta',
      delta: 'pong again',
      seq: 3,
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
      payload: { approvalRequestId: 'approval-1', toolCallId: 'tool-call-1' },
    }));
    agentRuntime.emit(createAgentRuntimeEvent('approval.requested', {
      payload: { approvalRequestId: 'approval-1', toolCallId: 'tool-call-1', approvalRequest },
    }));
    agentRuntime.emit(createAgentRuntimeEvent('context.ready', {
      payload: { included: 2 },
    }));
    unsubscribe();

    expect(window.webContents.send).toHaveBeenCalledWith('megumi:runtime:event', expect.objectContaining({
      eventType: 'approval.requested',
      runId: 'run-1',
      sessionId: 'session-1',
      sequence: 1,
      createdAt: '2026-06-19T00:00:00.000Z',
      payload: expect.objectContaining({
        approvalRequest: expect.objectContaining({
          approvalRequestId: 'approval-1',
          toolCallId: 'tool-call-1',
          toolName: 'write_file',
        }),
      }),
    }));
    expect(window.webContents.send).toHaveBeenCalledWith('megumi:runtime:event', expect.objectContaining({
      eventType: 'context.effective.updated',
      sequence: 2,
      payload: expect.objectContaining({
        workspaceId: 'workspace-1',
        sourceCount: 2,
      }),
    }));
  });
});
