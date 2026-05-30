import { describe, expect, it } from 'vitest';
import { reduceChatStreamEvent } from '@megumi/shared/chat-stream-to-timeline-projection';
import type { ChatStreamEvent } from '@megumi/shared/chat-stream-events';
import type { AnswerTextBlock, ProcessDisclosureBlock, TimelineAssistantMessage, TimelineMessage, TimelineUserMessage } from '@megumi/shared/timeline-message-blocks';

function chatEvent(overrides: Partial<ChatStreamEvent> & { eventType: ChatStreamEvent['eventType']; seq: number }): ChatStreamEvent {
  return {
    eventId: `event-${overrides.seq}`,
    projectId: 'project-1',
    sessionId: 'session-1',
    runId: 'run-1',
    streamId: 'stream-1',
    streamKind: 'main',
    createdAt: `2026-05-24T00:00:${String(overrides.seq).padStart(2, '0')}.000Z`,
    ...overrides,
  } as ChatStreamEvent;
}

function reduceEvents(events: ChatStreamEvent[], initialMessages: TimelineMessage[] = []): TimelineMessage[] {
  return events.reduce(reduceChatStreamEvent, initialMessages);
}

function assistantMessage(messages: TimelineMessage[]): TimelineAssistantMessage {
  const message = messages.find((candidate) => candidate.role === 'assistant');
  expect(message).toBeDefined();
  return message as TimelineAssistantMessage;
}

function userMessage(messages: TimelineMessage[]): TimelineUserMessage {
  const message = messages.find((candidate) => candidate.role === 'user');
  expect(message).toBeDefined();
  return message as TimelineUserMessage;
}

function processBlock(message: TimelineAssistantMessage): ProcessDisclosureBlock {
  const block = message.blocks.find((candidate) => candidate.kind === 'process_disclosure');
  expect(block).toBeDefined();
  return block as ProcessDisclosureBlock;
}

function answerBlock(message: TimelineAssistantMessage): AnswerTextBlock {
  const block = message.blocks.find((candidate) => candidate.kind === 'answer_text');
  expect(block).toBeDefined();
  return block as AnswerTextBlock;
}

describe('chat stream to timeline projection reducer', () => {
  it('projects a pure answer stream to user and assistant timeline messages', () => {
    const messages = reduceEvents([
      chatEvent({ eventType: 'turn.started', seq: 1, userMessageId: 'message-user-1' }),
      chatEvent({
        eventType: 'user.message.committed',
        seq: 2,
        clientMessageId: 'client-message-1',
        messageId: 'message-user-1',
        text: 'Hello Megumi',
      }),
      chatEvent({ eventType: 'assistant.text.started', seq: 3, textId: 'answer-text-1', phase: 'answer' }),
      chatEvent({ eventType: 'assistant.text.delta', seq: 4, textId: 'answer-text-1', phase: 'answer', delta: 'Hello ' }),
      chatEvent({ eventType: 'assistant.text.delta', seq: 5, textId: 'answer-text-1', phase: 'answer', delta: 'human.' }),
      chatEvent({ eventType: 'assistant.text.completed', seq: 6, textId: 'answer-text-1', phase: 'answer' }),
      chatEvent({ eventType: 'turn.completed', seq: 7, elapsedMs: 1234 }),
    ]);

    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('user');
    expect(messages[1]?.role).toBe('assistant');
    expect(userMessage(messages)).toMatchObject({
      messageId: 'message-user-1',
      role: 'user',
      projectId: 'project-1',
      sessionId: 'session-1',
      blocks: [
        {
          blockId: 'user-text:message-user-1',
          kind: 'user_text',
          text: 'Hello Megumi',
          format: 'plain',
        },
      ],
    });

    const assistant = assistantMessage(messages);
    expect(assistant).toMatchObject({
      messageId: 'assistant:run-1',
      role: 'assistant',
      runId: 'run-1',
      projectId: 'project-1',
      sessionId: 'session-1',
    });
    expect(assistant.blocks.map((block) => block.blockId)).toEqual(['process:run-1', 'answer:run-1']);
    expect(processBlock(assistant)).toMatchObject({
      kind: 'process_disclosure',
      runId: 'run-1',
      status: 'completed',
      startedAt: '2026-05-24T00:00:01.000Z',
      endedAt: '2026-05-24T00:00:07.000Z',
      items: [],
    });
    expect(answerBlock(assistant)).toMatchObject({
      kind: 'answer_text',
      runId: 'run-1',
      blockId: 'answer:run-1',
      textId: 'answer-text-1',
      status: 'completed',
      text: 'Hello human.',
      format: 'markdown',
    });
  });

  it('reconciles an optimistic user message by client message id', () => {
    const messages = reduceEvents(
      [
        chatEvent({
          eventType: 'user.message.committed',
          seq: 1,
          clientMessageId: 'client-message-1',
          messageId: 'message-user-1',
          text: 'Committed text',
        }),
      ],
      [
        {
          messageId: 'client-message-1',
          role: 'user',
          projectId: 'project-1',
          sessionId: 'session-1',
          createdAt: '2026-05-24T00:00:00.000Z',
          blocks: [
            {
              blockId: 'user-text:client-message-1',
              kind: 'user_text',
              text: 'Optimistic text',
              format: 'plain',
            },
          ],
        },
      ],
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      messageId: 'message-user-1',
      role: 'user',
      blocks: [
        {
          blockId: 'user-text:message-user-1',
          kind: 'user_text',
          text: 'Committed text',
          format: 'plain',
        },
      ],
    });
  });

  it('projects thinking, prelude, tool, approval, and streaming answer into one assistant message', () => {
    const messages = reduceEvents([
      chatEvent({ eventType: 'turn.started', seq: 1, userMessageId: 'message-user-1' }),
      chatEvent({ eventType: 'assistant.thinking.started', seq: 2, thinkingId: 'thinking-1' }),
      chatEvent({ eventType: 'assistant.thinking.delta', seq: 3, thinkingId: 'thinking-1', delta: 'Need context.' }),
      chatEvent({ eventType: 'assistant.thinking.completed', seq: 4, thinkingId: 'thinking-1' }),
      chatEvent({ eventType: 'assistant.text.started', seq: 5, textId: 'prelude-1', phase: 'prelude' }),
      chatEvent({ eventType: 'assistant.text.delta', seq: 6, textId: 'prelude-1', phase: 'prelude', delta: 'I will inspect the file.' }),
      chatEvent({ eventType: 'assistant.text.completed', seq: 7, textId: 'prelude-1', phase: 'prelude' }),
      chatEvent({
        eventType: 'tool.started',
        seq: 8,
        toolCallId: 'tool-call-1',
        toolExecutionId: 'tool-execution-1',
        toolName: 'read_file',
        displayName: 'Read file',
        inputSummary: 'README.md',
      }),
      chatEvent({
        eventType: 'approval.requested',
        seq: 9,
        approvalId: 'approval-1',
        toolCallId: 'tool-call-1',
        toolExecutionId: 'tool-execution-1',
        scope: 'project',
        status: 'pending',
        title: 'Read README',
        description: 'Allow file read',
        subjectSummary: 'README.md',
      }),
      chatEvent({
        eventType: 'approval.resolved',
        seq: 10,
        approvalId: 'approval-1',
        toolCallId: 'tool-call-1',
        toolExecutionId: 'tool-execution-1',
        scope: 'project',
        status: 'approved',
        decision: 'approved',
      }),
      chatEvent({
        eventType: 'tool.completed',
        seq: 11,
        toolCallId: 'tool-call-1',
        toolExecutionId: 'tool-execution-1',
        toolResultId: 'tool-result-1',
        toolName: 'read_file',
        displayName: 'Read file',
        inputSummary: 'README.md',
        resultSummary: 'Read 10 lines.',
      }),
      chatEvent({ eventType: 'assistant.text.started', seq: 12, textId: 'answer-text-1', phase: 'answer' }),
      chatEvent({ eventType: 'assistant.text.delta', seq: 13, textId: 'answer-text-1', phase: 'answer', delta: 'The file says hello.' }),
    ]);

    const assistant = assistantMessage(messages);
    expect(assistant.blocks.map((block) => block.blockId)).toEqual(['process:run-1', 'answer:run-1']);
    expect(processBlock(assistant).items).toEqual([
      {
        itemId: 'thinking:thinking-1',
        kind: 'thinking',
        thinkingId: 'thinking-1',
        status: 'completed',
        text: 'Need context.',
        format: 'plain',
        createdAt: '2026-05-24T00:00:02.000Z',
        updatedAt: '2026-05-24T00:00:04.000Z',
      },
      {
        itemId: 'prelude:prelude-1',
        kind: 'assistant_text',
        textId: 'prelude-1',
        phase: 'prelude',
        status: 'completed',
        text: 'I will inspect the file.',
        format: 'markdown',
        createdAt: '2026-05-24T00:00:05.000Z',
        updatedAt: '2026-05-24T00:00:07.000Z',
      },
      {
        itemId: 'tool:tool-call-1',
        kind: 'tool_activity',
        toolCallId: 'tool-call-1',
        toolExecutionId: 'tool-execution-1',
        toolResultId: 'tool-result-1',
        toolName: 'read_file',
        displayName: 'Read file',
        inputSummary: 'README.md',
        resultSummary: 'Read 10 lines.',
        status: 'succeeded',
        createdAt: '2026-05-24T00:00:08.000Z',
        updatedAt: '2026-05-24T00:00:11.000Z',
      },
      {
        itemId: 'approval:approval-1',
        kind: 'approval_activity',
        approvalId: 'approval-1',
        toolCallId: 'tool-call-1',
        toolExecutionId: 'tool-execution-1',
        scope: 'project',
        status: 'approved',
        title: 'Read README',
        description: 'Allow file read',
        subjectSummary: 'README.md',
        createdAt: '2026-05-24T00:00:09.000Z',
        updatedAt: '2026-05-24T00:00:10.000Z',
      },
    ]);
    expect(answerBlock(assistant)).toMatchObject({
      blockId: 'answer:run-1',
      textId: 'answer-text-1',
      status: 'streaming',
      text: 'The file says hello.',
    });
  });

  it('preserves partial answer text and appends terminal process items for failed and cancelled turns', () => {
    const failedMessages = reduceEvents([
      chatEvent({ eventType: 'turn.started', seq: 1, userMessageId: 'message-user-1' }),
      chatEvent({ eventType: 'assistant.text.started', seq: 2, textId: 'answer-text-1', phase: 'answer' }),
      chatEvent({ eventType: 'assistant.text.delta', seq: 3, textId: 'answer-text-1', phase: 'answer', delta: 'Partial answer.' }),
      chatEvent({
        eventType: 'assistant.text.failed',
        seq: 4,
        textId: 'answer-text-1',
        phase: 'answer',
        errorCode: 'provider_failed',
        errorMessage: 'Provider failed.',
      }),
      chatEvent({
        eventType: 'turn.failed',
        seq: 5,
        errorCode: 'provider_failed',
        errorMessage: 'Provider failed.',
        recoverable: true,
      }),
    ]);

    const failedAssistant = assistantMessage(failedMessages);
    expect(answerBlock(failedAssistant)).toMatchObject({
      status: 'failed',
      text: 'Partial answer.',
    });
    expect(processBlock(failedAssistant)).toMatchObject({
      status: 'failed',
      endedAt: '2026-05-24T00:00:05.000Z',
      items: [
        {
          itemId: 'error:run-1',
          kind: 'error_activity',
          errorCode: 'provider_failed',
          errorMessage: 'Provider failed.',
          recoverable: true,
        },
      ],
    });

    const cancelledMessages = reduceEvents([
      chatEvent({ eventType: 'turn.started', seq: 1, userMessageId: 'message-user-1', runId: 'run-cancelled' }),
      chatEvent({ eventType: 'assistant.text.started', seq: 2, textId: 'answer-text-2', phase: 'answer', runId: 'run-cancelled' }),
      chatEvent({
        eventType: 'assistant.text.delta',
        seq: 3,
        textId: 'answer-text-2',
        phase: 'answer',
        delta: 'Partial cancellation.',
        runId: 'run-cancelled',
      }),
      chatEvent({
        eventType: 'assistant.text.cancelled_partial',
        seq: 4,
        textId: 'answer-text-2',
        phase: 'answer',
        reason: 'User stopped the run.',
        runId: 'run-cancelled',
      }),
      chatEvent({
        eventType: 'turn.cancelled',
        seq: 5,
        reason: 'User stopped the run.',
        runId: 'run-cancelled',
      }),
    ]);

    const cancelledAssistant = assistantMessage(cancelledMessages);
    expect(answerBlock(cancelledAssistant)).toMatchObject({
      blockId: 'answer:run-cancelled',
      status: 'cancelled_partial',
      text: 'Partial cancellation.',
    });
    expect(processBlock(cancelledAssistant)).toMatchObject({
      blockId: 'process:run-cancelled',
      status: 'cancelled',
      endedAt: '2026-05-24T00:00:05.000Z',
      items: [
        {
          itemId: 'cancelled:run-cancelled',
          kind: 'cancelled_activity',
          reason: 'User stopped the run.',
        },
      ],
    });
  });

  it('keeps identical answer text in separate assistant messages by run id', () => {
    const messages = reduceEvents([
      chatEvent({ eventType: 'turn.started', seq: 1, runId: 'run-a', userMessageId: 'message-user-1' }),
      chatEvent({ eventType: 'assistant.text.started', seq: 2, runId: 'run-a', textId: 'answer-text-a', phase: 'answer' }),
      chatEvent({ eventType: 'assistant.text.delta', seq: 3, runId: 'run-a', textId: 'answer-text-a', phase: 'answer', delta: 'Same answer.' }),
      chatEvent({ eventType: 'assistant.text.completed', seq: 4, runId: 'run-a', textId: 'answer-text-a', phase: 'answer' }),
      chatEvent({ eventType: 'turn.started', seq: 5, runId: 'run-b', userMessageId: 'message-user-2' }),
      chatEvent({ eventType: 'assistant.text.started', seq: 6, runId: 'run-b', textId: 'answer-text-b', phase: 'answer' }),
      chatEvent({ eventType: 'assistant.text.delta', seq: 7, runId: 'run-b', textId: 'answer-text-b', phase: 'answer', delta: 'Same answer.' }),
      chatEvent({ eventType: 'assistant.text.completed', seq: 8, runId: 'run-b', textId: 'answer-text-b', phase: 'answer' }),
    ]);

    const assistantMessages = messages.filter(
      (candidate): candidate is TimelineAssistantMessage => candidate.role === 'assistant',
    );

    expect(assistantMessages.map((message) => message.messageId)).toEqual(['assistant:run-a', 'assistant:run-b']);
    expect(assistantMessages.map((message) => answerBlock(message).text)).toEqual(['Same answer.', 'Same answer.']);
  });
});
