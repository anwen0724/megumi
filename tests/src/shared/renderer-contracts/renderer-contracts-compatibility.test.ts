import { describe, expect, it } from 'vitest';
import {
  AGENT_LABELS,
  AGENT_TYPES,
  ChatStreamEventSchema,
  IPC_CHANNELS,
  RuntimeEventSchema,
  isPermissionMode,
  reduceChatStreamEvent,
} from '../../../../src/shared/renderer-contracts';
import type { ChatStreamEvent, TimelineMessage } from '../../../../src/shared/renderer-contracts';

describe('renderer contracts', () => {
  it('exports renderer IPC channels used by the migrated UI', () => {
    expect(IPC_CHANNELS.runtimeInvoke).toBe('megumi:invoke');
    expect(IPC_CHANNELS.runtimeEvent).toBe('megumi:runtime:event');
    expect(IPC_CHANNELS.chatStreamEvent).toBe('megumi:chat-stream:event');
  });

  it('exports runtime and chat stream schemas used by renderer dispatchers', () => {
    expect(RuntimeEventSchema.safeParse({
      id: 'event-1',
      type: 'run.started',
      createdAt: '2026-06-20T00:00:00.000Z',
      payload: {},
    }).success).toBe(true);

    expect(ChatStreamEventSchema.safeParse({
      eventId: 'chat-event-1',
      eventType: 'assistant.text.delta',
      projectId: 'project-1',
      sessionId: 'session-1',
      runId: 'run-1',
      streamId: 'chat-stream:run-1',
      streamKind: 'main',
      seq: 1,
      createdAt: '2026-06-20T00:00:00.000Z',
      textId: 'assistant-text:run-1:answer:0',
      phase: 'answer',
      delta: 'hello',
    }).success).toBe(true);

    expect(ChatStreamEventSchema.safeParse({
      type: 'ai.message.event',
      occurredAt: '2026-06-20T00:00:00.000Z',
      payload: { text: 'hello' },
    }).success).toBe(false);
  });

  it('exports renderer-only constants and reducers without importing packages/shared', () => {
    expect(AGENT_TYPES).toEqual(['analyst', 'architect', 'developer', 'reviewer', 'free']);
    expect(AGENT_LABELS.analyst).toBeTruthy();
    expect(isPermissionMode('default')).toBe(true);
    expect(typeof reduceChatStreamEvent).toBe('function');
  });

  it('reconciles an optimistic user message by client message id like the legacy reducer', () => {
    const optimistic: TimelineMessage = {
      messageId: 'client-message-1',
      role: 'user',
      projectId: 'project-1',
      sessionId: 'session-1',
      clientMessageId: 'client-message-1',
      createdAt: '2026-06-20T00:00:00.000Z',
      blocks: [{
        blockId: 'user-text:client-message-1',
        kind: 'user_text',
        text: 'Optimistic text',
        format: 'plain',
      }],
    };
    const committed: ChatStreamEvent = {
      eventId: 'event-1',
      eventType: 'user.message.committed',
      projectId: 'project-1',
      sessionId: 'session-1',
      runId: 'run-1',
      streamId: 'chat-stream:run-1',
      streamKind: 'main',
      seq: 2,
      createdAt: '2026-06-20T00:00:01.000Z',
      clientMessageId: 'client-message-1',
      messageId: 'message-user-1',
      text: 'Committed text',
    };

    const messages = reduceChatStreamEvent([optimistic], committed);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      messageId: 'message-user-1',
      role: 'user',
      runId: 'run-1',
      clientMessageId: 'client-message-1',
      blocks: [{
        blockId: 'user-text:message-user-1',
        kind: 'user_text',
        text: 'Committed text',
      }],
    });
  });
});
