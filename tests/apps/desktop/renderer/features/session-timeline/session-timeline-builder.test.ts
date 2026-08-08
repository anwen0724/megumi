import { describe, expect, it } from 'vitest';
import type {
  SessionConversationItemDto,
  SessionMessageDto,
  UserMessageDto,
  WorkspaceChangeSummaryDto,
} from '@megumi/product/host';
import {
  buildCommittedRunTimeline,
  buildSessionTimeline,
} from '../../../../../../apps/desktop/src/renderer/features/session-timeline/session-timeline-builder';
import type {
  TimelineAssistantMessage,
  TimelineUserMessage,
} from '../../../../../../apps/desktop/src/renderer/features/session-timeline/timeline-model';

describe('Session Timeline builder', () => {
  it('preserves Session order, Skill selection, and attachment ordinal', () => {
    const userMessage = user('user:1', 'Inspect the attachments.');
    userMessage.skillSelection = {
      name: 'review-code',
      skillPath: 'C:/skills/review-code/SKILL.md',
    };
    userMessage.attachments = [
      attachment('attachment:document', 'second.pdf', 'file', 1),
      attachment('attachment:image', 'first.png', 'image', 0),
    ];

    const timeline = buildSessionTimeline({
      projectId: 'project:1',
      sessionId: 'session:1',
      conversation: [messageItem(userMessage), messageItem(reply('assistant:1', 'completed', 'Done.'))],
      workspaceChanges: [],
    });

    const projectedUser = timeline[0] as TimelineUserMessage;
    expect(projectedUser.skillSelection).toEqual(userMessage.skillSelection);
    expect(projectedUser.blocks
      .filter((block) => block.kind === 'user_attachment')
      .map((block) => block.name)).toEqual(['first.png', 'second.pdf']);
    expect(timeline.map((message) => message.role)).toEqual(['user', 'assistant']);
  });

  it('reconstructs Thinking, prelude, Tool activity, and the final reply', () => {
    const conversation = [
      messageItem(user('user:1', 'Inspect README.')),
      messageItem(modelResponse('model:1', [
        { type: 'thinking', thinking: 'I should read the file.' },
        { type: 'text', text: 'I will inspect it.' },
        { type: 'toolCall', id: 'tool:1', name: 'read_file', arguments: { path: 'README.md' } },
      ], 'toolUse')),
      messageItem(toolResult('tool-result:1', 'tool:1', 'read_file', 'success')),
      messageItem(reply('assistant:1', 'completed', 'Done.')),
    ];

    const timeline = buildSessionTimeline({
      projectId: 'project:1',
      sessionId: 'session:1',
      conversation,
      workspaceChanges: [],
    });
    const assistant = timeline[1] as TimelineAssistantMessage;

    expect(assistant.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'process_disclosure',
        items: expect.arrayContaining([
          expect.objectContaining({ kind: 'thinking', text: 'I should read the file.' }),
          expect.objectContaining({ kind: 'assistant_text', text: 'I will inspect it.' }),
          expect.objectContaining({
            kind: 'tool_activity',
            toolCallId: 'tool:1',
            toolName: 'read_file',
            inputSummary: 'README.md',
            status: 'succeeded',
          }),
        ]),
      }),
      expect.objectContaining({ kind: 'answer_text', status: 'completed', text: 'Done.' }),
    ]));
  });

  it.each([
    ['failed', 'failed'],
    ['cancelled', 'cancelled'],
  ] as const)('preserves a %s final reply', (status, expectedStatus) => {
    const timeline = buildSessionTimeline({
      projectId: 'project:1',
      sessionId: 'session:1',
      conversation: [
        messageItem(user('user:1', 'Hello.')),
        messageItem(reply('assistant:1', status, status === 'failed' ? 'Partial.' : '')),
      ],
      workspaceChanges: [],
    });
    const assistant = timeline[1] as TimelineAssistantMessage;
    expect(assistant.blocks).toContainEqual(expect.objectContaining({
      kind: 'answer_text',
      status: expectedStatus,
    }));
  });

  it('does not synthesize historical output for the active Run', () => {
    const timeline = buildSessionTimeline({
      projectId: 'project:1',
      sessionId: 'session:1',
      conversation: [messageItem(user('user:1', 'Hello.'))],
      workspaceChanges: [],
      activeRun: {
        runId: 'run:1',
        sessionId: 'session:1',
        status: 'running',
        createdAt: time(1),
      },
    });
    expect(timeline).toHaveLength(2);
    expect(timeline[0]?.role).toBe('user');
    const assistant = timeline[1] as TimelineAssistantMessage;
    expect(assistant.blocks).toEqual([
      expect.objectContaining({
        kind: 'process_disclosure',
        status: 'running',
        items: [],
      }),
    ]);
    expect(assistant.blocks).not.toContainEqual(expect.objectContaining({ kind: 'answer_text' }));
  });

  it('restores Branch and every persisted Compaction terminal state without messages', () => {
    const statuses = ['running', 'completed', 'failed', 'cancelled', 'interrupted'] as const;
    const conversation: SessionConversationItemDto[] = [
      {
        type: 'branch',
        branchId: 'branch:1',
        sourceMessageId: 'user:source',
        targetMessageId: 'user:target',
        createdAt: time(1),
      },
      ...statuses.map((status, index): SessionConversationItemDto => ({
        type: 'compaction',
        compactionId: `compaction:${index}`,
        trigger: 'manual',
        status,
        startedAt: time(index + 2),
        ...(status === 'running' ? {} : { completedAt: time(index + 3) }),
        ...(status === 'failed' || status === 'interrupted'
          ? { error: { code: 'context_error', message: 'Could not compact.' } }
          : {}),
      })),
    ];

    const timeline = buildSessionTimeline({
      projectId: 'project:1',
      sessionId: 'session:1',
      conversation,
      workspaceChanges: [],
    });

    expect(timeline[0]).toMatchObject({
      role: 'separator',
      sessionId: 'session:1',
      blocks: [expect.objectContaining({ branchMarkerId: 'branch:1' })],
    });
    expect(timeline.slice(1).map((message) => message.blocks[0]?.status)).toEqual(statuses);
  });

  it('attaches Host-safe Workspace Changes to the matching Run', () => {
    const workspaceChanges: WorkspaceChangeSummaryDto[] = [{
      runId: 'run:1',
      sessionId: 'session:1',
      changeSetId: 'changes:1',
      changedFileCount: 1,
      files: [{
        changedFileId: 'changed-file:1',
        workspacePath: 'README.md',
        changeKind: 'modified',
      }],
      updatedAt: time(3),
    }];
    const timeline = buildSessionTimeline({
      projectId: 'project:1',
      sessionId: 'session:1',
      conversation: [messageItem(user('user:1', 'Update it.')), messageItem(reply('assistant:1', 'completed', 'Done.'))],
      workspaceChanges,
    });

    expect((timeline[1] as TimelineAssistantMessage).workspaceChangeFooter).toEqual({
      runId: 'run:1',
      sessionId: 'session:1',
      updatedAt: time(3),
      changeSets: [{
        changeSetId: 'changes:1',
        changedFileCount: 1,
        files: [{
          changedFileId: 'changed-file:1',
          workspacePath: 'README.md',
          changeKind: 'modified',
        }],
      }],
    });
  });

  it('builds a single committed Run for terminal reconciliation', () => {
    const timeline = buildCommittedRunTimeline({
      projectId: 'project:1',
      messages: [messageItem(user('user:1', 'Hello.')), messageItem(reply('assistant:1', 'completed', 'Hi.'))],
      workspaceChanges: [],
    });
    expect(timeline).toEqual([
      expect.objectContaining({ role: 'user', runId: 'run:1' }),
      expect.objectContaining({ role: 'assistant', runId: 'run:1' }),
    ]);
  });
});

function messageBase(messageId: string) {
  return {
    messageId,
    sessionId: 'session:1',
    runId: 'run:1',
    createdAt: time(1),
    completedAt: time(2),
  };
}

function user(messageId: string, text: string): UserMessageDto {
  return {
    ...messageBase(messageId),
    kind: 'user',
    displayContent: [{ type: 'text', text }],
    attachments: [],
  };
}

function reply(
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

function modelResponse(
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

function toolResult(
  messageId: string,
  toolCallId: string,
  toolName: string,
  status: Extract<SessionMessageDto, { kind: 'toolResult' }>['status'],
): Extract<SessionMessageDto, { kind: 'toolResult' }> {
  return {
    ...messageBase(messageId),
    kind: 'toolResult',
    toolCallId,
    toolName,
    status,
    content: [{ type: 'text', text: 'file contents' }],
  };
}

function attachment(
  attachmentId: string,
  name: string,
  type: 'image' | 'file',
  ordinal: number,
): UserMessageDto['attachments'][number] {
  return {
    attachmentId,
    type,
    name,
    source: 'localFile',
    ordinal,
    createdAt: time(1),
  };
}

function messageItem(message: SessionMessageDto) {
  return {
    type: 'message' as const,
    entryId: `entry:${message.messageId}`,
    message,
  };
}

function time(second: number): string {
  return `2026-07-19T00:00:${second.toString().padStart(2, '0')}.000Z`;
}
