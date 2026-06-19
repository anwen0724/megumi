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
});
