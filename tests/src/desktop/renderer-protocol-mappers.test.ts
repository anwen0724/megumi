// Locks desktop projection from Agent runtime facts into renderer protocol DTOs.
import { describe, expect, it, vi } from 'vitest';
import type { AgentRuntimeEvent, AgentRuntimePort } from '../../../src/app';
import { registerChatStreamEventForwarder } from '../../../src/desktop/ipc/events/chat-stream-event-forwarder';
import { registerRuntimeEventForwarder } from '../../../src/desktop/ipc/events/runtime-event-forwarder';
import { createAgentRuntimeChatStreamAdapter } from '../../../src/desktop/renderer-protocol/chat-stream/agent-runtime-chat-stream-adapter';
import { mapAgentRuntimeEventToChatStreamEvent } from '../../../src/desktop/renderer-protocol/chat-stream/agent-runtime-event-to-chat-stream-event';
import { mapAgentRuntimeEventToRendererRuntimeEvent } from '../../../src/desktop/renderer-protocol/runtime/agent-runtime-event-to-renderer-runtime-event';
import { ChatStreamEventSchema } from '../../../src/shared/renderer-contracts/chat-stream';
import { RuntimeEventSchema } from '../../../src/shared/renderer-contracts/runtime';

function agentRuntimeEvent(type: string, payload: Record<string, unknown> = {}): AgentRuntimeEvent {
  return {
    type,
    occurredAt: '2026-06-20T00:00:00.000Z',
    runId: 'run-1',
    sessionId: 'session-1',
    workspaceId: 'workspace-1',
    payload,
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
  createdAt: '2026-06-20T00:00:00.000Z',
  policyDecision: {
    id: 'permission-decision-1',
    kind: 'ask',
    reason: 'write_requires_approval',
    mode: 'default',
    operation: 'write',
    actionName: 'write_file',
    target: 'src/a.ts',
    risk: { level: 'sensitive', reasons: ['write_file'] },
    createdAt: '2026-06-20T00:00:00.000Z',
  },
};

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
    subscribe(listener) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    emit(event) {
      for (const subscriber of subscribers) subscriber(event);
    },
  };
}

function createFakeWindow() {
  return { webContents: { send: vi.fn() } };
}

describe('desktop renderer protocol mappers', () => {
  it('maps approval.requested Agent events to chat stream approval.requested DTOs', () => {
    const event = mapAgentRuntimeEventToChatStreamEvent(agentRuntimeEvent('approval.requested', {
      approvalRequestId: 'approval-1',
      toolCallId: 'tool-call-1',
      approvalRequest,
    }));

    expect(event).toEqual(expect.objectContaining({
      eventType: 'approval.requested',
      approvalId: 'approval-1',
      toolCallId: 'tool-call-1',
      scope: 'once',
      status: 'pending',
      title: 'write_file',
      description: 'write_requires_approval',
      subjectSummary: 'src/a.ts',
      approvalRequest: expect.objectContaining({
        approvalRequestId: 'approval-1',
        toolCallId: 'tool-call-1',
        runId: 'run-1',
        toolName: 'write_file',
        title: 'write_file',
        summary: 'write_requires_approval',
        preview: expect.objectContaining({
          action: 'write',
          targets: [{ kind: 'target', label: 'src/a.ts', sensitivity: 'sensitive' }],
        }),
        requestedScope: 'once',
        status: 'pending',
      }),
    }));
    expect(ChatStreamEventSchema.safeParse(event).success).toBe(true);
  });

  it('maps approval.requested Agent events to runtime approval.requested DTOs', () => {
    const event = mapAgentRuntimeEventToRendererRuntimeEvent(agentRuntimeEvent('approval.requested', {
      approvalRequestId: 'approval-1',
      toolCallId: 'tool-call-1',
      requestId: 'request-1',
      approvalRequest,
    }), { sequence: 5 });

    expect(event).toEqual(expect.objectContaining({
      eventId: 'runtime-event:run-1:5',
      eventType: 'approval.requested',
      projectId: 'workspace-1',
      runId: 'run-1',
      sessionId: 'session-1',
      requestId: 'request-1',
      sequence: 5,
      payload: {
        approvalRequest: expect.objectContaining({
          approvalRequestId: 'approval-1',
          toolCallId: 'tool-call-1',
          runId: 'run-1',
          toolName: 'write_file',
          preview: expect.objectContaining({
            action: 'write',
            targets: [{ kind: 'target', label: 'src/a.ts', sensitivity: 'sensitive' }],
          }),
        }),
      },
    }));
    expect(RuntimeEventSchema.safeParse(event).success).toBe(true);
  });

  it('does not map incomplete approval.requested Agent events as successful renderer DTOs', () => {
    expect(mapAgentRuntimeEventToChatStreamEvent(agentRuntimeEvent('approval.requested', {
      approvalRequestId: 'approval-1',
      toolCallId: 'tool-call-1',
    }))).toBeUndefined();
    expect(mapAgentRuntimeEventToRendererRuntimeEvent(agentRuntimeEvent('approval.requested', {
      approvalRequestId: 'approval-1',
      toolCallId: 'tool-call-1',
    }))).toBeUndefined();
  });

  it('maps assistant text deltas and tool lifecycle events to valid chat stream DTOs', () => {
    const text = mapAgentRuntimeEventToChatStreamEvent(agentRuntimeEvent('ai.message.event', {
      seq: 7,
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'hello' },
      },
    }));
    const started = mapAgentRuntimeEventToChatStreamEvent(agentRuntimeEvent('tool.execution.started', {
      seq: 8,
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
      toolName: 'read_file',
    }));
    const completed = mapAgentRuntimeEventToChatStreamEvent(agentRuntimeEvent('tool.execution.completed', {
      seq: 9,
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
      toolName: 'read_file',
      status: 'succeeded',
      summary: 'read ok',
    }));

    expect(text).toEqual(expect.objectContaining({ eventType: 'assistant.text.delta', delta: 'hello', seq: 7 }));
    expect(started).toEqual(expect.objectContaining({ eventType: 'tool.started', toolName: 'read_file', seq: 8 }));
    expect(completed).toEqual(expect.objectContaining({ eventType: 'tool.completed', resultSummary: 'read ok', seq: 9 }));
    expect(ChatStreamEventSchema.safeParse(text).success).toBe(true);
    expect(ChatStreamEventSchema.safeParse(started).success).toBe(true);
    expect(ChatStreamEventSchema.safeParse(completed).success).toBe(true);
  });

  it('maps terminal runtime events with identifiers needed to reset renderer sending state', () => {
    for (const [source, expected] of [
      ['completed', 'run.completed'],
      ['failed', 'run.failed'],
      ['cancelled', 'run.cancelled'],
    ] as const) {
      const event = mapAgentRuntimeEventToRendererRuntimeEvent(agentRuntimeEvent('run.status.changed', {
        status: source,
        requestId: 'request-1',
      }), { sequence: 10 });
      expect(event).toEqual(expect.objectContaining({
        eventType: expected,
        projectId: 'workspace-1',
        sessionId: 'session-1',
        runId: 'run-1',
        requestId: 'request-1',
      }));
      expect(RuntimeEventSchema.safeParse(event).success).toBe(true);
    }
  });

  it('keeps non-projectable internal events out of chat stream sequence', () => {
    const events: unknown[] = [];
    const adapter = createAgentRuntimeChatStreamAdapter({ publish: (event) => events.push(event) });

    adapter.handle(agentRuntimeEvent('context.ready', { included: 2 }));
    adapter.handle(agentRuntimeEvent('workspace.changed', { path: 'src/a.ts' }));
    adapter.handle(agentRuntimeEvent('ai.message.event', {
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'hello' },
      },
    }));

    expect(events).toEqual([
      expect.objectContaining({ eventType: 'assistant.text.started', seq: 1 }),
      expect.objectContaining({ eventType: 'assistant.text.delta', seq: 2 }),
    ]);
  });

  it('forwarders only emit renderer-valid DTOs', () => {
    const agentRuntime = createFakeAgentRuntime();
    const chatWindow = createFakeWindow();
    const runtimeWindow = createFakeWindow();
    const unsubscribeChat = registerChatStreamEventForwarder({
      agentRuntime,
      getMainWindow: () => chatWindow as never,
    });
    const unsubscribeRuntime = registerRuntimeEventForwarder({
      agentRuntime,
      getMainWindow: () => runtimeWindow as never,
    });

    agentRuntime.emit(agentRuntimeEvent('approval.requested', {
      approvalRequestId: 'approval-1',
      toolCallId: 'tool-call-1',
    }));
    agentRuntime.emit(agentRuntimeEvent('approval.requested', {
      approvalRequestId: 'approval-1',
      toolCallId: 'tool-call-1',
      approvalRequest,
    }));
    unsubscribeChat();
    unsubscribeRuntime();

    expect(runtimeWindow.webContents.send).toHaveBeenCalledTimes(1);
    expect(RuntimeEventSchema.safeParse(runtimeWindow.webContents.send.mock.calls[0][1]).success).toBe(true);
  });
});
