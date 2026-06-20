// Locks timeline history replay to the same renderer chat-stream protocol used live.
import { describe, expect, it, vi } from 'vitest';
import type { AgentRuntimeEvent } from '../../../src/app';
import { mapTimelineHydration } from '../../../src/desktop/renderer-protocol/timeline/history';
import { TimelineHistoryCommitProjector } from '../../../src/desktop/renderer-protocol/timeline/timeline-history-projection';
import { createTimelineHistoryCommitService } from '../../../src/desktop/services/timeline-history-commit-service';
import type { SqliteTimelineMessageRepository } from '../../../src/database';
import type { SessionRunRecord } from '../../../src/session';
import type { ChatStreamEvent } from '../../../src/shared/renderer-contracts/chat-stream';
import type { TimelineMessage } from '../../../src/shared/renderer-contracts/timeline';

const base = {
  projectId: 'workspace-1',
  sessionId: 'session-1',
  runId: 'run-1',
  streamId: 'chat-stream:run-1',
  streamKind: 'main',
  createdAt: '2026-06-20T00:00:00.000Z',
};

function chatEvent(seq: number, fields: Partial<ChatStreamEvent> & { eventType: ChatStreamEvent['eventType'] }): ChatStreamEvent {
  return {
    ...base,
    eventId: `chat-event-${seq}`,
    seq,
    ...fields,
  } as ChatStreamEvent;
}

function runtimeEvent(sequence: number, type: string, payload: Record<string, unknown> = {}): AgentRuntimeEvent & { eventId: string; sequence: number } {
  return {
    eventId: `runtime-event:run-1:${sequence}`,
    sequence,
    type,
    runId: 'run-1',
    sessionId: 'session-1',
    workspaceId: 'workspace-1',
    occurredAt: `2026-06-20T00:00:0${sequence}.000Z`,
    payload: { sequence, ...payload },
  };
}

describe('timeline history protocol', () => {
  it('projects terminal chat-stream events into canonical renderer timeline commit payloads', () => {
    const projector = new TimelineHistoryCommitProjector();

    expect(projector.publish(chatEvent(1, { eventType: 'turn.started' }))).toBeUndefined();
    expect(projector.publish(chatEvent(2, {
      eventType: 'user.message.committed',
      messageId: 'message-user-1',
      clientMessageId: 'client-message-1',
      text: 'hello',
    }))).toBeUndefined();
    expect(projector.publish(chatEvent(3, {
      eventType: 'assistant.text.delta',
      textId: 'answer-1',
      phase: 'answer',
      delta: 'world',
    }))).toBeUndefined();
    expect(projector.publish(chatEvent(4, {
      eventType: 'tool.started',
      toolCallId: 'tool-call-1',
      toolName: 'read_file',
      inputSummary: 'src/a.ts',
    }))).toBeUndefined();
    expect(projector.publish(chatEvent(5, {
      eventType: 'tool.completed',
      toolCallId: 'tool-call-1',
      toolName: 'read_file',
      resultSummary: 'ok',
    }))).toBeUndefined();
    const result = projector.publish(chatEvent(6, { eventType: 'turn.completed', createdAt: '2026-06-20T00:00:06.000Z' }));

    expect(result?.kind).toBe('commit');
    if (result?.kind !== 'commit') {
      throw new Error('Expected timeline commit projection result.');
    }
    const commit = result.payload;
    const assistant = commit.messages.find((message) => message.role === 'assistant');
    const answer = assistant?.blocks.find((block) => block.kind === 'answer_text');
    const process = assistant?.blocks.find((block) => block.kind === 'process_disclosure');

    expect(commit.sessionPreview).toBe('world');
    expect(answer).toEqual(expect.objectContaining({ text: 'world', status: 'streaming' }));
    expect(process).toEqual(expect.objectContaining({
      status: 'completed',
      items: [expect.objectContaining({ kind: 'tool_activity', status: 'succeeded', toolName: 'read_file' })],
    }));
  });

  it('records diagnostics from the desktop service when timeline persistence fails', () => {
    const repository = {
      commitRunTimeline: vi.fn(() => {
        throw new Error('disk full');
      }),
      recordCommitDiagnostic: vi.fn(),
    } as unknown as SqliteTimelineMessageRepository;
    const service = createTimelineHistoryCommitService({
      repository,
      createDiagnosticId: () => 'diagnostic-1',
    });

    service.handle(runtimeEvent(1, 'turn.started', { userMessageText: 'hello' }));
    service.handle(runtimeEvent(2, 'ai.message.event', {
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'world' } },
    }));
    service.handle(runtimeEvent(3, 'run.completed', { status: 'completed' }));

    expect(repository.commitRunTimeline).toHaveBeenCalledTimes(1);
    expect(repository.recordCommitDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
      diagnosticId: 'diagnostic-1',
      projectId: 'workspace-1',
      sessionId: 'session-1',
      runId: 'run-1',
      code: 'timeline_commit_failed',
      message: 'Timeline commit failed.',
      createdAt: '2026-06-20T00:00:03.000Z',
    }));
  });

  it('hydrates runtime event history through the live chat-stream adapter protocol', () => {
    const hydration = mapTimelineHydration({
      projectId: 'workspace-1',
      sessionId: 'session-1',
      messages: [],
      runs: [{
        id: 'run-1',
        sessionId: 'session-1',
        sourceEntryId: 'source-run-1',
        inputSummary: 'hello',
        status: 'completed',
        startedAt: '2026-06-20T00:00:00.000Z',
      } as SessionRunRecord],
      activePath: [],
      runtimeEvents: [
        runtimeEvent(1, 'turn.started'),
        runtimeEvent(2, 'ai.message.event', {
          event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Inspect.' } },
        }),
        runtimeEvent(3, 'ai.message.event', {
          event: { type: 'content_block_end', index: 0, block: { type: 'thinking', thinking: 'Inspect.' } },
        }),
        runtimeEvent(4, 'ai.message.event', {
          event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Answer.' } },
        }),
        runtimeEvent(5, 'ai.message.completed'),
        runtimeEvent(6, 'tool.call.created', {
          toolCallId: 'tool-call-1',
          toolName: 'read_file',
          input: { path: 'src/a.ts' },
        }),
        runtimeEvent(7, 'tool.result.created', {
          toolCallId: 'tool-call-1',
          toolName: 'read_file',
          status: 'success',
          summary: 'ok',
        }),
        runtimeEvent(8, 'run.status.changed', { status: 'completed' }),
      ],
    });

    const assistant = hydration.messages.find((message) => message.role === 'assistant');
    const answer = assistant?.blocks.find((block) => block.kind === 'answer_text');
    const process = assistant?.blocks.find((block) => block.kind === 'process_disclosure');

    expect(answer).toEqual(expect.objectContaining({ text: 'Answer.', status: 'completed' }));
    expect(process).toEqual(expect.objectContaining({
      status: 'completed',
      items: [
        expect.objectContaining({ kind: 'thinking', text: 'Inspect.', status: 'completed' }),
        expect.objectContaining({ kind: 'tool_activity', toolName: 'read_file', status: 'succeeded' }),
      ],
    }));
  });
});
