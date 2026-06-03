// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as Shared from '@megumi/shared';
import {
  ChatStreamEventSchema,
  ChatStreamEventTypeSchema,
  AssistantTextDeltaEventSchema,
  ToolCompletedEventSchema,
} from '@megumi/shared/chat-stream-event-schemas';
import {
  createAssistantTextDeltaChatStreamEvent,
  createChatStreamEvent,
} from '@megumi/shared/chat-stream-event-factory';
import {
  ASSISTANT_TEXT_PHASES,
  CHAT_STREAM_EVENT_TYPES,
  type ChatStreamEvent,
} from '@megumi/shared/chat-stream-events';

const base = {
  eventId: 'chat-stream-event-1',
  projectId: 'project-1',
  sessionId: 'session-1',
  runId: 'run-1',
  streamId: 'stream-main-1',
  streamKind: 'main',
  seq: 1,
  createdAt: '2026-05-24T00:00:00.000Z',
} as const;

describe('chat stream event contract', () => {
  it('lists the UI-facing event types without assistant answer events', () => {
    expect(CHAT_STREAM_EVENT_TYPES).toEqual([
      'turn.started',
      'turn.completed',
      'turn.failed',
      'turn.cancelled',
      'user.message.committed',
      'assistant.text.started',
      'assistant.text.delta',
      'assistant.text.reclassified',
      'assistant.text.completed',
      'assistant.text.failed',
      'assistant.text.cancelled_partial',
      'assistant.thinking.started',
      'assistant.thinking.delta',
      'assistant.thinking.completed',
      'tool.started',
      'tool.completed',
      'tool.failed',
      'tool.denied',
      'approval.requested',
      'approval.resolved',
      'branch.separator.created',
      'branch.separator.removed',
      'process.compaction.recorded',
      'process.retry.recorded',
      'process.recovery.recorded',
    ]);
    expect(CHAT_STREAM_EVENT_TYPES.some((type) => type.startsWith('assistant.answer.'))).toBe(false);
    expect(ASSISTANT_TEXT_PHASES).toEqual(['prelude', 'answer']);
    expect(ChatStreamEventTypeSchema.parse('assistant.text.delta')).toBe('assistant.text.delta');
    expect(() => ChatStreamEventTypeSchema.parse('assistant.answer.delta')).toThrow();
  });

  it('parses a pure text answer sequence', () => {
    const events = [
      {
        ...base,
        eventType: 'turn.started',
        userMessageId: 'message-user-1',
        clientMessageId: 'client-message-1',
      },
      {
        ...base,
        eventId: 'chat-stream-event-2',
        eventType: 'user.message.committed',
        clientMessageId: 'client-message-1',
        messageId: 'message-user-1',
        text: 'Hello',
        seq: 2,
      },
      {
        ...base,
        eventId: 'chat-stream-event-3',
        eventType: 'assistant.text.started',
        textId: 'text-answer-1',
        phase: 'answer',
        seq: 3,
      },
      {
        ...base,
        eventId: 'chat-stream-event-4',
        eventType: 'assistant.text.delta',
        textId: 'text-answer-1',
        phase: 'answer',
        delta: 'Hello there',
        seq: 4,
      },
      {
        ...base,
        eventId: 'chat-stream-event-5',
        eventType: 'assistant.text.completed',
        textId: 'text-answer-1',
        phase: 'answer',
        seq: 5,
      },
      {
        ...base,
        eventId: 'chat-stream-event-6',
        eventType: 'turn.completed',
        elapsedMs: 1200,
        seq: 6,
      },
    ] satisfies ChatStreamEvent[];

    expect(events.map((event) => ChatStreamEventSchema.parse(event).eventType)).toEqual([
      'turn.started',
      'user.message.committed',
      'assistant.text.started',
      'assistant.text.delta',
      'assistant.text.completed',
      'turn.completed',
    ]);
  });

  it('keeps prelude text and final answer text separated by phase', () => {
    const prelude = AssistantTextDeltaEventSchema.parse({
      ...base,
      eventType: 'assistant.text.delta',
      textId: 'text-prelude-1',
      phase: 'prelude',
      delta: 'Let me check.',
    });
    const answer = AssistantTextDeltaEventSchema.parse({
      ...base,
      eventId: 'chat-stream-event-answer',
      eventType: 'assistant.text.delta',
      textId: 'text-answer-1',
      phase: 'answer',
      delta: 'The directory contains docs.',
    });

    expect(prelude.phase).toBe('prelude');
    expect(answer.phase).toBe('answer');
  });

  it('parses assistant text reclassification events', () => {
    expect(ChatStreamEventSchema.parse({
      ...base,
      eventType: 'assistant.text.reclassified',
      textId: 'text-1',
      fromPhase: 'answer',
      toPhase: 'prelude',
    })).toMatchObject({
      eventType: 'assistant.text.reclassified',
      textId: 'text-1',
      fromPhase: 'answer',
      toPhase: 'prelude',
    });
  });

  it('parses thinking, tool, approval, and terminal events', () => {
    expect(ChatStreamEventSchema.parse({
      ...base,
      eventType: 'assistant.thinking.started',
      thinkingId: 'thinking-1',
    }).eventType).toBe('assistant.thinking.started');

    expect(ToolCompletedEventSchema.parse({
      ...base,
      eventId: 'chat-stream-event-tool',
      eventType: 'tool.completed',
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
      toolResultId: 'tool-result-1',
      toolName: 'read_file',
      displayName: 'Read file',
      inputSummary: 'docs/README.md',
      resultSummary: 'Read 20 lines.',
    }).resultSummary).toBe('Read 20 lines.');

    expect(ChatStreamEventSchema.parse({
      ...base,
      eventId: 'chat-stream-event-approval',
      eventType: 'approval.requested',
      approvalId: 'approval-1',
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
      scope: 'project',
      status: 'pending',
      title: 'Run command',
      description: 'npm test',
      subjectSummary: 'npm test',
    }).eventType).toBe('approval.requested');

    expect(ChatStreamEventSchema.parse({
      ...base,
      eventId: 'chat-stream-event-cancel',
      eventType: 'assistant.text.cancelled_partial',
      textId: 'text-answer-1',
      phase: 'answer',
      reason: 'user_requested',
    }).eventType).toBe('assistant.text.cancelled_partial');
  });

  it('parses branch separator and process fact chat stream events', () => {
    expect(createChatStreamEvent({
      eventId: 'event-branch-1',
      eventType: 'branch.separator.created',
      projectId: 'project-1',
      sessionId: 'session-1',
      runId: 'run-1',
      streamId: 'stream-1',
      streamKind: 'main',
      seq: 1,
      createdAt: '2026-06-01T10:00:00.000Z',
      branchMarkerId: 'branch-marker-1',
      sourceMessageId: 'message-1',
      label: 'Branch from 07:28',
    }).eventType).toBe('branch.separator.created');

    expect(createChatStreamEvent({
      eventId: 'event-branch-remove-1',
      eventType: 'branch.separator.removed',
      projectId: 'project-1',
      sessionId: 'session-1',
      runId: 'run-1',
      streamId: 'stream-1',
      streamKind: 'main',
      seq: 2,
      createdAt: '2026-06-01T10:00:01.000Z',
      branchMarkerId: 'branch-marker-1',
    }).eventType).toBe('branch.separator.removed');

    expect(createChatStreamEvent({
      eventId: 'event-retry-1',
      eventType: 'process.retry.recorded',
      projectId: 'project-1',
      sessionId: 'session-1',
      runId: 'run-1',
      streamId: 'stream-1',
      streamKind: 'main',
      seq: 2,
      createdAt: '2026-06-01T10:00:01.000Z',
      retryAttemptId: 'retry-attempt-1',
      attemptNumber: 1,
      status: 'failed',
      label: 'Retry attempt 1 failed',
      reason: 'rate_limited',
    }).eventType).toBe('process.retry.recorded');
  });

  it('requires explicit stream identity and rejects runId as streamId', () => {
    expect(() => ChatStreamEventSchema.parse({
      ...base,
      eventType: 'turn.started',
      userMessageId: 'message-user-1',
      streamId: 'run-1',
    })).toThrow(/streamId/);

    expect(() => ChatStreamEventSchema.parse({
      ...base,
      eventType: 'turn.started',
      userMessageId: 'message-user-1',
      seq: 0,
    })).toThrow();
  });

  it('rejects runId as streamId on per-event schemas', () => {
    expect(() => ToolCompletedEventSchema.parse({
      ...base,
      eventId: 'chat-stream-event-tool-invalid-stream',
      eventType: 'tool.completed',
      streamId: base.runId,
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
      toolResultId: 'tool-result-1',
      toolName: 'read_file',
      displayName: 'Read file',
      inputSummary: 'docs/README.md',
      resultSummary: 'Read 20 lines.',
    })).toThrow(/streamId/);
  });

  it('rejects raw provider bodies and final UI copy fields on payloads', () => {
    expect(() => ChatStreamEventSchema.parse({
      ...base,
      eventType: 'tool.completed',
      toolCallId: 'tool-call-1',
      toolName: 'read_file',
      resultSummary: 'Read file.',
      rawProviderBody: { secret: 'sk-test' },
    })).toThrow();

    expect(() => ChatStreamEventSchema.parse({
      ...base,
      eventType: 'tool.completed',
      toolCallId: 'tool-call-1',
      toolName: 'read_file',
      resultSummary: 'Read file.',
      displayText: 'Megumi read docs/README.md',
    })).toThrow();
  });

  it('rejects legacy toolUseId fields on tool and approval events', () => {
    expect(() => ChatStreamEventSchema.parse({
      ...base,
      eventType: 'tool.started',
      toolUseId: 'tool-use-1',
      toolName: 'read_file',
    })).toThrow();

    expect(() => ChatStreamEventSchema.parse({
      ...base,
      eventType: 'approval.requested',
      approvalId: 'approval-1',
      toolUseId: 'tool-use-1',
      scope: 'project',
      status: 'pending',
      title: 'Run command',
    })).toThrow();
  });
});

describe('chat stream event factory', () => {
  it('creates typed chat stream events without runtime event envelope fields', () => {
    const event = createChatStreamEvent({
      ...base,
      eventType: 'tool.started',
      toolCallId: 'tool-call-1',
      toolName: 'read_file',
      inputSummary: 'docs/README.md',
    });

    expect(event.eventType).toBe('tool.started');
    expect(ChatStreamEventSchema.parse(event)).toEqual(event);
    expect(event).not.toHaveProperty('schemaVersion');
    expect(event).not.toHaveProperty('payload');
  });

  it('creates assistant text delta events with explicit phase', () => {
    const event = createAssistantTextDeltaChatStreamEvent({
      ...base,
      textId: 'text-answer-1',
      phase: 'answer',
      delta: 'Streaming answer.',
    });

    expect(event).toMatchObject({
      eventType: 'assistant.text.delta',
      phase: 'answer',
      delta: 'Streaming answer.',
    });
    expect(ChatStreamEventSchema.parse(event)).toEqual(event);
  });
});

describe('root shared exports', () => {
  it('keeps approval event schema root exports on runtime event envelopes', () => {
    const approvalRequest = {
      approvalRequestId: 'approval-1',
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
      runId: 'run-1',
      stepId: 'step-1',
      toolName: 'edit_file',
      capabilities: ['project_write' as const],
      riskLevel: 'medium' as const,
      title: 'Edit file',
      summary: 'Edit src/app.ts',
      preview: {
        action: 'Edit file',
        targets: [{ kind: 'file' as const, label: 'src/app.ts', sensitivity: 'normal' as const }],
      },
      requestedScope: 'once' as const,
      status: 'pending' as const,
      createdAt: '2026-05-20T00:00:00.000Z',
    };

    const runtimeApprovalRequestedEvent = {
      eventId: 'event-approval-requested',
      schemaVersion: 1 as const,
      eventType: 'approval.requested',
      runId: 'run-1',
      sessionId: 'session-1',
      stepId: 'step-1',
      sequence: 1,
      createdAt: '2026-05-20T00:00:00.000Z',
      source: 'approval' as const,
      visibility: 'user' as const,
      persist: 'required' as const,
      payload: { approvalRequest },
    };

    expect(Shared.ApprovalRequestedEventSchema.parse(runtimeApprovalRequestedEvent)).toEqual(
      runtimeApprovalRequestedEvent,
    );
    expect(() => Shared.ApprovalRequestedEventSchema.parse({
      ...base,
      eventType: 'approval.requested',
      approvalId: 'approval-1',
      scope: 'project',
      status: 'pending',
      title: 'Run command',
    })).toThrow();
  });
});
