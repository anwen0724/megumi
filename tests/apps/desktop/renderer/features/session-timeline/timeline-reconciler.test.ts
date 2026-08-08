import { describe, expect, it } from 'vitest';
import {
  reconcileCommittedRunMessages,
  reconcileTimelineMessages,
  upsertPendingUserMessage,
} from '../../../../../../apps/desktop/src/renderer/features/session-timeline/timeline-reconciler';
import type {
  TimelineAssistantMessage,
  TimelineMessage,
} from '../../../../../../apps/desktop/src/renderer/features/session-timeline/timeline-model';

describe('Timeline reconciler', () => {
  it('keeps live disclosure while accepting the committed final answer', () => {
    const reconciled = reconcileTimelineMessages(
      [assistant('run:1', 'streaming', 'Partial', true)],
      [assistant('run:1', 'completed', 'Final', false)],
    );
    const message = reconciled[0] as TimelineAssistantMessage;

    expect(message.blocks).toEqual([
      expect.objectContaining({
        kind: 'process_disclosure',
        items: [expect.objectContaining({ kind: 'thinking', text: 'Thinking' })],
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

    expect(reconciled.find((message) => message.runId === 'run:2')).toBe(current[2]);
    expect(JSON.stringify(reconciled.filter((message) => message.runId === 'run:1'))).toContain('Final');
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
      runId: 'run:1',
      text: 'Hello',
      createdAt: time(2),
    });

    expect(committed).toHaveLength(1);
    expect(committed[0]).toMatchObject({
      messageId: 'user:1',
      clientMessageId: 'client:1',
      runId: 'run:1',
    });
  });
});

function user(messageId: string, runId: string): TimelineMessage {
  return {
    messageId,
    role: 'user',
    projectId: 'project:1',
    sessionId: 'session:1',
    runId,
    createdAt: time(runId === 'run:1' ? 1 : 3),
    blocks: [{
      blockId: `text:${messageId}`,
      kind: 'user_text',
      text: messageId,
      format: 'plain',
    }],
  };
}

function assistant(
  runId: string,
  answerStatus: 'streaming' | 'completed',
  text: string,
  withThinking: boolean,
): TimelineAssistantMessage {
  return {
    messageId: `assistant:${runId}`,
    role: 'assistant',
    projectId: 'project:1',
    sessionId: 'session:1',
    runId,
    createdAt: time(runId === 'run:1' ? 2 : 4),
    blocks: [{
      blockId: `process:${runId}`,
      kind: 'process_disclosure',
      runId,
      status: answerStatus === 'completed' ? 'completed' : 'running',
      items: withThinking ? [{
        itemId: `thinking:${runId}`,
        kind: 'thinking',
        thinkingId: `thinking:${runId}`,
        status: answerStatus === 'completed' ? 'completed' : 'streaming',
        text: 'Thinking',
        format: 'markdown',
      }] : [],
    }, {
      blockId: `answer:${runId}`,
      kind: 'answer_text',
      runId,
      textId: `text:${runId}`,
      status: answerStatus,
      text,
      format: 'markdown',
    }],
  };
}

function time(second: number): string {
  return `2026-07-19T00:00:${second.toString().padStart(2, '0')}.000Z`;
}
