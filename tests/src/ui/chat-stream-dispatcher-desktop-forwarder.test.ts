import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentRuntimeEvent, AgentRuntimePort } from '../../../src/app';
import { registerChatStreamEventForwarder } from '../../../src/desktop/ipc/events/chat-stream-event-forwarder';
import { mapAgentRuntimeEventToChatStreamEvent } from '../../../src/desktop/renderer-protocol/agent-runtime-event-to-chat-stream-event.mapper';
import { dispatchChatStreamEvent } from '../../../src/ui/features/chat-stream/chat-stream-dispatcher';
import { chatStreamSessionKey, useChatStreamStore } from '../../../src/ui/features/chat-stream/chat-stream-store';

function agentRuntimeEvent(payload: Record<string, unknown>): AgentRuntimeEvent {
  return {
    type: 'ai.message.event',
    occurredAt: '2026-06-19T00:00:01.000Z',
    runId: 'run-1',
    sessionId: 'session-1',
    workspaceId: 'workspace-1',
    payload: {
      seq: 1,
      ...payload,
    },
  };
}

function runtimeEvent(type: string, payload: Record<string, unknown> = {}, seq = 1): AgentRuntimeEvent {
  return {
    type,
    occurredAt: '2026-06-19T00:00:01.000Z',
    runId: 'run-1',
    sessionId: 'session-1',
    workspaceId: 'workspace-1',
    payload: {
      seq,
      ...payload,
    },
  };
}

function createFakeAgentRuntime(): AgentRuntimePort & { emit(event: AgentRuntimeEvent): void } {
  const listeners = new Set<(event: AgentRuntimeEvent) => void>();
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
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(event) {
      for (const listener of listeners) listener(event);
    },
  };
}

function agentEvent(type: string, payload: Record<string, unknown> = {}, occurredAt = '2026-06-19T00:00:01.000Z'): AgentRuntimeEvent {
  return {
    type,
    occurredAt,
    runId: 'run-1',
    sessionId: 'session-1',
    workspaceId: 'workspace-1',
    payload,
  };
}

describe('src/ui chat stream dispatcher desktop projection compatibility', () => {
  beforeEach(() => {
    useChatStreamStore.getState().reset();
  });

  it('dispatches desktop-forwarded renderer chat stream events instead of dropping them', () => {
    const forwarded = mapAgentRuntimeEventToChatStreamEvent(agentRuntimeEvent({
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'hello from desktop' },
      },
    }));

    expect(forwarded).toEqual(expect.objectContaining({ eventType: 'assistant.text.delta' }));

    dispatchChatStreamEvent(forwarded);
    useChatStreamStore.getState().flushStream('workspace-1', 'session-1', 'chat-stream:run-1');

    const session = useChatStreamStore.getState().sessions[chatStreamSessionKey('workspace-1', 'session-1')];
    expect(JSON.stringify(session.messages)).toContain('hello from desktop');
  });

  it('does not expose ordinary context construction as a disclosure item', () => {
    const forwarded = [
      mapAgentRuntimeEventToChatStreamEvent(runtimeEvent('turn.started', {}, 1)),
      mapAgentRuntimeEventToChatStreamEvent(runtimeEvent('context.ready', { included: 3 }, 2)),
      mapAgentRuntimeEventToChatStreamEvent(runtimeEvent('run.status.changed', { status: 'completed' }, 2)),
    ];

    for (const event of forwarded) {
      if (event) dispatchChatStreamEvent(event);
    }
    useChatStreamStore.getState().flushStream('workspace-1', 'session-1', 'chat-stream:run-1');

    const session = useChatStreamStore.getState().sessions[chatStreamSessionKey('workspace-1', 'session-1')];
    const assistant = session.messages.find((message) => message.role === 'assistant');
    const process = assistant?.blocks.find((block) => block.kind === 'process_disclosure');

    expect(process).toEqual(expect.objectContaining({
      status: 'completed',
      items: [],
    }));
  });

  it('reconciles the optimistic user message when the committed user event arrives after turn start', () => {
    useChatStreamStore.getState().addPendingUserMessage('workspace-1', 'session-1', {
      clientMessageId: 'client-message-1',
      text: '你爱我吗？',
      createdAt: '2026-06-19T00:00:00.000Z',
    });

    dispatchChatStreamEvent({
      eventId: 'event-1',
      eventType: 'turn.started',
      projectId: 'workspace-1',
      sessionId: 'session-1',
      runId: 'run-1',
      streamId: 'chat-stream:run-1',
      streamKind: 'main',
      seq: 1,
      createdAt: '2026-06-19T00:00:01.000Z',
      userMessageId: 'message-user-1',
      clientMessageId: 'client-message-1',
    });
    dispatchChatStreamEvent({
      eventId: 'event-2',
      eventType: 'user.message.committed',
      projectId: 'workspace-1',
      sessionId: 'session-1',
      runId: 'run-1',
      streamId: 'chat-stream:run-1',
      streamKind: 'main',
      seq: 2,
      createdAt: '2026-06-19T00:00:02.000Z',
      messageId: 'message-user-1',
      clientMessageId: 'client-message-1',
      text: '你爱我吗？',
    });
    useChatStreamStore.getState().flushStream('workspace-1', 'session-1', 'chat-stream:run-1');

    const session = useChatStreamStore.getState().sessions[chatStreamSessionKey('workspace-1', 'session-1')];

    expect(session.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(session.messages.filter((message) => message.role === 'user')).toEqual([
      expect.objectContaining({
        messageId: 'message-user-1',
        clientMessageId: 'client-message-1',
      }),
    ]);
  });

  it('projects live disclosure like the legacy runtime adapter', () => {
    const runtime = createFakeAgentRuntime();
    const sent: unknown[] = [];
    registerChatStreamEventForwarder({
      agentRuntime: runtime,
      getMainWindow: () => ({ webContents: { send: (_channel: string, event: unknown) => sent.push(event) } }) as never,
    });

    runtime.emit(agentEvent('turn.started'));
    runtime.emit(agentEvent('context.ready', { included: 3 }));
    runtime.emit(agentEvent('ai.message.event', {
      event: { type: 'content_block_start', index: 0, block: { type: 'thinking', thinking: '' } },
    }));
    runtime.emit(agentEvent('ai.message.event', {
      event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Need inspect files.' } },
    }));
    runtime.emit(agentEvent('ai.message.event', {
      event: { type: 'content_block_end', index: 0, block: { type: 'thinking', thinking: 'Need inspect files.' } },
    }));
    runtime.emit(agentEvent('ai.message.event', {
      event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '好的，让我先看看项目目录下有哪些文件。' } },
    }));
    runtime.emit(agentEvent('ai.message.event', {
      event: { type: 'content_block_delta', index: 2, delta: { type: 'tool_call_delta', id: 'call-list', name: 'list_directory', argumentsTextDelta: '{"path":"."}' } },
    }));
    runtime.emit(agentEvent('ai.message.completed', { contentBlocks: 2 }));
    runtime.emit(agentEvent('tool.call.created', {
      toolCallId: 'call-list',
      toolName: 'list_directory',
      input: { path: '.' },
    }));
    runtime.emit(agentEvent('tool.execution.started', {
      toolCallId: 'call-list',
      toolExecutionId: 'execution-list',
      toolName: 'list_directory',
      input: { path: '.' },
    }));
    runtime.emit(agentEvent('tool.execution.completed', {
      toolCallId: 'call-list',
      toolExecutionId: 'execution-list',
      toolName: 'list_directory',
      status: 'success',
    }));
    runtime.emit(agentEvent('tool.result.created', {
      toolCallId: 'call-list',
      toolExecutionId: 'execution-list',
      toolName: 'list_directory',
      status: 'success',
    }));
    runtime.emit(agentEvent('run.status.changed', { status: 'completed' }));

    for (const event of sent) {
      dispatchChatStreamEvent(event as never);
    }
    useChatStreamStore.getState().flushStream('workspace-1', 'session-1', 'chat-stream:run-1');

    const session = useChatStreamStore.getState().sessions[chatStreamSessionKey('workspace-1', 'session-1')];
    const assistant = session.messages.find((message) => message.role === 'assistant');
    const process = assistant?.blocks.find((block) => block.kind === 'process_disclosure');

    expect(process).toEqual(expect.objectContaining({
      status: 'completed',
      items: [
        expect.objectContaining({
          kind: 'thinking',
          status: 'completed',
          text: 'Need inspect files.',
        }),
        expect.objectContaining({
          kind: 'assistant_text',
          status: 'completed',
          text: '好的，让我先看看项目目录下有哪些文件。',
        }),
        expect.objectContaining({
          kind: 'tool_activity',
          status: 'succeeded',
          toolName: 'list_directory',
          inputSummary: '.',
        }),
      ],
    }));
  });
});
