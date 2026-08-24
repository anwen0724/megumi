import { describe, expect, it } from 'vitest';
import {
  reconcileCommittedRunMessages,
  reconcileTimelineMessages,
  upsertPendingUserMessage,
} from '../../../../../../apps/desktop/src/renderer/features/session-timeline/timeline-reconciler';
import { buildCommittedRunTimeline } from '../../../../../../apps/desktop/src/renderer/features/session-timeline/session-timeline-builder';
import type {
  TimelineAssistantMessage,
  TimelineMessage,
} from '../../../../../../apps/desktop/src/renderer/features/session-timeline/timeline-model';
import type {
  SessionMessageDto,
  UserMessageDto,
} from '@megumi/product-host/host';

describe('Timeline reconciler', () => {
  it('keeps live disclosure while accepting the committed final answer', () => {
    const committed = assistant('run:1', 'completed', 'Final', false);
    const committedProcess = committed.blocks.find((block) => block.kind === 'process_disclosure')!;
    committedProcess.items.push({
      itemId: 'assistant-text:committed',
      kind: 'assistant_text',
      textId: 'text:committed',
      phase: 'prelude',
      status: 'completed',
      text: 'Persisted prelude',
      format: 'markdown',
    });
    const reconciled = reconcileTimelineMessages(
      [assistant('run:1', 'streaming', 'Partial', true)],
      [committed],
    );
    const message = reconciled[0] as TimelineAssistantMessage;

    expect(message.blocks).toEqual([
      expect.objectContaining({
        kind: 'process_disclosure',
        items: expect.arrayContaining([
          expect.objectContaining({ kind: 'thinking', text: 'Thinking' }),
          expect.objectContaining({ kind: 'assistant_text', text: 'Persisted prelude' }),
        ]),
      }),
      expect.objectContaining({ kind: 'answer_text', status: 'completed', text: 'Final' }),
    ]);
  });

  it('reconciles only the requested Run', () => {
    const current = [
      user('user:1', 'run:1'),
      assistant('run:1', 'streaming', 'Partial', true),
      user('user:2', 'run:2'),
      assistant('run:2', 'streaming', 'Untouched', true),
    ];
    const reconciled = reconcileCommittedRunMessages(
      current,
      'run:1',
      [user('user:1', 'run:1'), assistant('run:1', 'completed', 'Final', false)],
    );

    expect(reconciled.find((message) => message.executionId === 'run:2')).toBe(current[2]);
    expect(JSON.stringify(reconciled.filter((message) => message.executionId === 'run:1'))).toContain('Final');
  });

  it('deduplicates the live thinking item against the committed reconstruction', () => {
    const committed = buildCommittedRunTimeline({
      projectId: 'project:1',
      messages: [
        messageItem(userDto('user:1', 'Inspect README.')),
        messageItem(modelResponseDto('model:1', [
          { type: 'thinking', thinking: 'I should read the file.' },
          { type: 'text', text: 'I will inspect it.' },
        ], 'toolUse')),
        messageItem(replyDto('assistant:1', 'completed', 'Done.')),
      ],
      workspaceChanges: [],
    });

    const live = assistant('run:1', 'streaming', 'Partial', true);
    const process = live.blocks.find((block) => block.kind === 'process_disclosure')!;
    process.items = [{
      itemId: 'thinking:model:1',
      kind: 'thinking',
      thinkingId: 'model:1',
      status: 'streaming',
      text: 'I should read the file.',
      format: 'markdown',
    }];

    const reconciled = reconcileCommittedRunMessages([live], 'run:1', committed);
    const assistantMessage = reconciled.find((message) => message.role === 'assistant') as TimelineAssistantMessage;
    const thinkingItems = assistantMessage.blocks
      .find((block) => block.kind === 'process_disclosure')!
      .items.filter((item) => item.kind === 'thinking');

    expect(thinkingItems).toHaveLength(1);
    expect(thinkingItems[0]).toMatchObject({ text: 'I should read the file.' });
  });

  it('replaces an optimistic user identity instead of duplicating the turn', () => {
    const pending = upsertPendingUserMessage([], {
      projectId: 'project:1',
      sessionId: 'session:1',
      clientMessageId: 'client:1',
      text: 'Hello',
      createdAt: time(1),
    });
    const committed = upsertPendingUserMessage(pending, {
      projectId: 'project:1',
      sessionId: 'session:1',
      clientMessageId: 'client:1',
      messageId: 'user:1',
      executionId: 'run:1',
      text: 'Hello',
      createdAt: time(2),
    });

    expect(committed).toHaveLength(1);
    expect(committed[0]).toMatchObject({
      messageId: 'user:1',
      clientMessageId: 'client:1',
      executionId: 'run:1',
    });
  });
});

function user(messageId: string, executionId: string): TimelineMessage {
  return {
    messageId,
    role: 'user',
    projectId: 'project:1',
    sessionId: 'session:1',
    executionId,
    createdAt: time(executionId === 'run:1' ? 1 : 3),
    blocks: [{
      blockId: `text:${messageId}`,
      kind: 'user_text',
      text: messageId,
      format: 'plain',
    }],
  };
}

function assistant(
  executionId: string,
  answerStatus: 'streaming' | 'completed',
  text: string,
  withThinking: boolean,
): TimelineAssistantMessage {
  return {
    messageId: `assistant:${executionId}`,
    role: 'assistant',
    projectId: 'project:1',
    sessionId: 'session:1',
    executionId,
    createdAt: time(executionId === 'run:1' ? 2 : 4),
    blocks: [{
      blockId: `process:${executionId}`,
      kind: 'process_disclosure',
      executionId,
      status: answerStatus === 'completed' ? 'completed' : 'running',
      items: withThinking ? [{
        itemId: `thinking:${executionId}`,
        kind: 'thinking',
        thinkingId: `thinking:${executionId}`,
        status: answerStatus === 'completed' ? 'completed' : 'streaming',
        text: 'Thinking',
        format: 'markdown',
      }] : [],
    }, {
      blockId: `answer:${executionId}`,
      kind: 'answer_text',
      executionId,
      textId: `text:${executionId}`,
      status: answerStatus,
      text,
      format: 'markdown',
    }],
  };
}

function time(second: number): string {
  return `2026-07-19T00:00:${second.toString().padStart(2, '0')}.000Z`;
}

function messageBase(messageId: string) {
  return {
    messageId,
    sessionId: 'session:1',
    executionId: 'run:1',
    createdAt: time(1),
    completedAt: time(2),
  };
}

function userDto(messageId: string, text: string): UserMessageDto {
  return {
    ...messageBase(messageId),
    kind: 'user',
    displayContent: [{ type: 'text', text }],
    attachments: [],
  };
}

function replyDto(
  messageId: string,
  status: 'completed' | 'failed' | 'cancelled',
  text: string,
): Extract<SessionMessageDto, { kind: 'assistantReply' }> {
  return {
    ...messageBase(messageId),
    kind: 'assistantReply',
    status,
    reasonCode: status === 'completed' ? 'normal_completion' : status,
    content: text ? [{ type: 'text', text }] : [],
  };
}

function modelResponseDto(
  messageId: string,
  content: Extract<SessionMessageDto, { kind: 'modelResponse' }>['content'],
  stopReason: string,
): Extract<SessionMessageDto, { kind: 'modelResponse' }> {
  return {
    ...messageBase(messageId),
    kind: 'modelResponse',
    outcomeStatus: 'completed',
    stopReason,
    content,
  };
}

function messageItem(message: SessionMessageDto) {
  return {
    type: 'message' as const,
    entryId: `entry:${message.messageId}`,
    message,
  };
}
