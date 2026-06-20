// Locks timeline history replay to the same renderer chat-stream protocol used live.
import { describe, expect, it, vi } from 'vitest';
import type { AgentRuntimeEvent } from '../../../src/app';
import { mapTimelineHydration } from '../../../src/desktop/renderer-protocol/timeline/history';
import { TimelineHistoryCommitProjector } from '../../../src/desktop/renderer-protocol/timeline/timeline-history-projection';
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
  it('commits terminal chat-stream events as canonical renderer timeline messages', () => {
    const commitRunTimeline = vi.fn((input: { messages: TimelineMessage[] }) => input.messages);
    const projector = new TimelineHistoryCommitProjector({
      repository: {
        commitRunTimeline,
        recordCommitDiagnostic: vi.fn(),
      },
      createDiagnosticId: () => 'diagnostic-1',
    });

    projector.publish(chatEvent(1, { eventType: 'turn.started' }));
    projector.publish(chatEvent(2, {
      eventType: 'user.message.committed',
      messageId: 'message-user-1',
      clientMessageId: 'client-message-1',
      text: 'hello',
    }));
    projector.publish(chatEvent(3, {
      eventType: 'assistant.text.delta',
      textId: 'answer-1',
      phase: 'answer',
      delta: 'world',
    }));
    projector.publish(chatEvent(4, {
      eventType: 'tool.started',
      toolCallId: 'tool-call-1',
      toolName: 'read_file',
      inputSummary: 'src/a.ts',
    }));
    projector.publish(chatEvent(5, {
      eventType: 'tool.completed',
      toolCallId: 'tool-call-1',
      toolName: 'read_file',
      resultSummary: 'ok',
    }));
    projector.publish(chatEvent(6, { eventType: 'turn.completed', createdAt: '2026-06-20T00:00:06.000Z' }));

    expect(commitRunTimeline).toHaveBeenCalledTimes(1);
    const [commit] = commitRunTimeline.mock.calls[0] as unknown as [{ messages: TimelineMessage[]; sessionPreview?: string }];
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
