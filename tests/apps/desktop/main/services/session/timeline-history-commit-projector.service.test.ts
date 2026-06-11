// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  TimelineHistoryCommitProjectorService,
  type TimelineHistoryCommitRepository,
} from '@megumi/desktop/main/services/session/timeline-history-commit-projector.service';
import { ChatStreamEventSchema, type ChatStreamEvent } from '@megumi/shared';
import type {
  AnswerTextBlock,
  ProcessDisclosureBlock,
  TimelineAssistantMessage,
  TimelineMessage,
} from '@megumi/shared/timeline';

type CommitInput = Parameters<TimelineHistoryCommitRepository['commitRunTimeline']>[0];
type CommitDiagnostic = Parameters<TimelineHistoryCommitRepository['recordCommitDiagnostic']>[0];

function event(
  overrides: Partial<ChatStreamEvent> & { eventType: ChatStreamEvent['eventType']; seq: number },
): ChatStreamEvent {
  const runId = overrides.runId ?? 'run-1';
  return ChatStreamEventSchema.parse({
    eventId: `event-${runId}-${overrides.seq}`,
    projectId: 'project-1',
    sessionId: 'session-1',
    runId,
    streamId: overrides.streamId ?? 'stream-main-1',
    streamKind: 'main',
    createdAt: `2026-05-24T00:00:${String(overrides.seq).padStart(2, '0')}.000Z`,
    ...overrides,
  });
}

function createRepository(options: { failCommit?: Error } = {}) {
  const commits: CommitInput[] = [];
  const diagnostics: CommitDiagnostic[] = [];
  const repository: TimelineHistoryCommitRepository = {
    commitRunTimeline: vi.fn((input) => {
      if (options.failCommit) {
        throw options.failCommit;
      }
      commits.push(input);
      return input.messages;
    }),
    recordCommitDiagnostic: vi.fn((diagnostic) => {
      diagnostics.push(diagnostic);
    }),
  };

  return { repository, commits, diagnostics };
}

function assistantMessage(messages: TimelineMessage[]): TimelineAssistantMessage {
  const message = messages.find(
    (candidate): candidate is TimelineAssistantMessage => candidate.role === 'assistant',
  );
  if (!message) {
    throw new Error('Expected an assistant timeline message.');
  }
  return message;
}

function processBlock(message: TimelineAssistantMessage): ProcessDisclosureBlock {
  const block = message.blocks.find(
    (candidate): candidate is ProcessDisclosureBlock => candidate.kind === 'process_disclosure',
  );
  if (!block) {
    throw new Error('Expected a process disclosure block.');
  }
  return block;
}

function answerBlock(message: TimelineAssistantMessage): AnswerTextBlock {
  const block = message.blocks.find(
    (candidate): candidate is AnswerTextBlock => candidate.kind === 'answer_text',
  );
  if (!block) {
    throw new Error('Expected an answer text block.');
  }
  return block;
}

describe('TimelineHistoryCommitProjectorService', () => {
  it('commits completed user and assistant canonical messages and forwards every event downstream', () => {
    const { repository, commits } = createRepository();
    const downstream = { publish: vi.fn() };
    const service = new TimelineHistoryCommitProjectorService({
      repository,
      downstream,
      ids: { diagnosticId: () => 'diagnostic-1' },
    });
    const events = [
      event({ eventType: 'turn.started', seq: 1, userMessageId: 'message-user-1' }),
      event({
        eventType: 'user.message.committed',
        seq: 2,
        clientMessageId: 'client-message-1',
        messageId: 'message-user-1',
        text: 'Hello Megumi',
      }),
      event({ eventType: 'assistant.text.started', seq: 3, textId: 'prelude-1', phase: 'prelude' }),
      event({
        eventType: 'assistant.text.delta',
        seq: 4,
        textId: 'prelude-1',
        phase: 'prelude',
        delta: 'Reading context.',
      }),
      event({ eventType: 'assistant.text.completed', seq: 5, textId: 'prelude-1', phase: 'prelude' }),
      event({ eventType: 'assistant.text.started', seq: 6, textId: 'answer-1', phase: 'answer' }),
      event({ eventType: 'assistant.text.delta', seq: 7, textId: 'answer-1', phase: 'answer', delta: 'Hello ' }),
      event({ eventType: 'assistant.text.delta', seq: 8, textId: 'answer-1', phase: 'answer', delta: 'human.' }),
      event({ eventType: 'assistant.text.completed', seq: 9, textId: 'answer-1', phase: 'answer' }),
      event({ eventType: 'turn.completed', seq: 10, elapsedMs: 1000 }),
    ];

    events.forEach((chatEvent) => service.publish(chatEvent));

    expect(downstream.publish).toHaveBeenCalledTimes(events.length);
    expect(downstream.publish).toHaveBeenNthCalledWith(1, events[0]);
    expect(downstream.publish).toHaveBeenNthCalledWith(events.length, events.at(-1));
    expect(repository.commitRunTimeline).toHaveBeenCalledTimes(1);
    expect(commits[0]).toMatchObject({
      projectId: 'project-1',
      sessionId: 'session-1',
      runId: 'run-1',
      committedAt: '2026-05-24T00:00:10.000Z',
      sessionPreview: 'Hello human.',
    });
    expect(commits[0]?.messages.map((message) => message.role)).toEqual(['user', 'assistant']);

    const assistant = assistantMessage(commits[0]?.messages ?? []);
    expect(processBlock(assistant)).toMatchObject({
      status: 'completed',
      items: [
        {
          kind: 'assistant_text',
          textId: 'prelude-1',
          phase: 'prelude',
          status: 'completed',
          text: 'Reading context.',
        },
      ],
    });
    expect(answerBlock(assistant)).toMatchObject({
      kind: 'answer_text',
      textId: 'answer-1',
      status: 'completed',
      text: 'Hello human.',
    });
  });

  it('commits branch separators and process fact blocks through the shared timeline reducer', () => {
    const { repository, commits } = createRepository();
    const service = new TimelineHistoryCommitProjectorService({
      repository,
      ids: { diagnosticId: () => 'diagnostic-1' },
    });

    [
      event({
        eventType: 'branch.separator.created',
        seq: 1,
        branchMarkerId: 'branch-marker-1',
        sourceMessageId: 'message-user-1',
        label: 'Branch from 10:00',
      }),
      event({ eventType: 'turn.started', seq: 2, userMessageId: 'message-user-2' }),
      event({
        eventType: 'process.compaction.recorded',
        seq: 3,
        compactionId: 'compaction-1',
        status: 'completed',
        label: 'Compacted context',
      }),
      event({
        eventType: 'process.retry.recorded',
        seq: 4,
        retryAttemptId: 'retry-attempt-1',
        attemptNumber: 1,
        status: 'started',
        label: 'Retry attempt 1 started',
        reason: 'user_requested',
      }),
      event({
        eventType: 'process.recovery.recorded',
        seq: 5,
        status: 'interrupted',
        label: 'Previous run was interrupted',
      }),
      event({ eventType: 'turn.completed', seq: 6 }),
    ].forEach((chatEvent) => service.publish(chatEvent));

    expect(repository.commitRunTimeline).toHaveBeenCalledTimes(2);
    expect(commits[0]?.messages[0]).toMatchObject({
      role: 'separator',
      blocks: [{ kind: 'branch_separator', branchMarkerId: 'branch-marker-1' }],
    });
    expect(processBlock(assistantMessage(commits[1]?.messages ?? [])).items).toEqual([
      expect.objectContaining({ kind: 'compaction_activity', label: 'Compacted context' }),
      expect.objectContaining({ kind: 'retry_activity', label: 'Retry attempt 1 started' }),
      expect.objectContaining({ kind: 'recovery_activity', label: 'Previous run was interrupted' }),
    ]);
  });

  it('forwards live-only workspace footer streams without creating history commit state', () => {
    const { repository } = createRepository();
    const downstream = { publish: vi.fn() };
    const service = new TimelineHistoryCommitProjectorService({
      repository,
      downstream,
      ids: { diagnosticId: () => 'diagnostic-1' },
    });
    const footerEvent = event({
      eventType: 'workspace.change.footer.updated',
      seq: 1,
      streamId: 'chat-stream:run-1:workspace-change-footer',
      streamKind: 'workspace-change-footer',
      footer: {
        runId: 'run-1',
        sessionId: 'session-1',
        updatedAt: '2026-06-06T10:00:00.000Z',
        changeSets: [{
          changeSetId: 'workspace-change-set-1',
          changedFileCount: 1,
          restorableCount: 0,
          restoredCount: 1,
          conflictCount: 0,
          failedCount: 0,
          hasRestorableChanges: false,
          files: [{
            changedFileId: 'workspace-changed-file-1',
            projectPath: 'src/app.ts',
            changeKind: 'modified',
            restoreState: 'restored',
          }],
        }],
      },
    });

    service.publish(footerEvent);
    service.publish(event({
      eventType: 'turn.completed',
      seq: 2,
      streamId: 'chat-stream:run-1:workspace-change-footer',
      streamKind: 'workspace-change-footer',
    }));

    expect(downstream.publish).toHaveBeenCalledTimes(2);
    expect(downstream.publish).toHaveBeenNthCalledWith(1, footerEvent);
    expect(repository.commitRunTimeline).not.toHaveBeenCalled();
    expect(repository.recordCommitDiagnostic).not.toHaveBeenCalled();
  });

  it('commits a branch separator-only stream immediately and ignores a later terminal for that stream', () => {
    const { repository, commits } = createRepository();
    const service = new TimelineHistoryCommitProjectorService({
      repository,
      ids: { diagnosticId: () => 'diagnostic-1' },
    });
    const separator = event({
      eventType: 'branch.separator.created',
      seq: 1,
      streamId: 'branch-draft:branch-marker-1',
      branchMarkerId: 'branch-marker-1',
      sourceMessageId: 'message-user-1',
      label: 'Branch from 10:00',
    });

    service.publish(separator);
    service.publish(event({
      eventType: 'turn.completed',
      seq: 2,
      streamId: 'branch-draft:branch-marker-1',
    }));

    expect(repository.commitRunTimeline).toHaveBeenCalledTimes(1);
    expect(commits[0]).toMatchObject({
      runId: 'run-1',
      committedAt: separator.createdAt,
      messages: [{
        role: 'separator',
        blocks: [{ kind: 'branch_separator', branchMarkerId: 'branch-marker-1' }],
      }],
    });
  });

  it('commits failed and cancelled partial answers with terminal statuses and partial text', () => {
    const { commits, repository } = createRepository();
    const service = new TimelineHistoryCommitProjectorService({
      repository,
      ids: { diagnosticId: () => 'diagnostic-1' },
    });

    [
      event({ eventType: 'turn.started', seq: 1, runId: 'run-failed', streamId: 'stream-failed', userMessageId: 'message-user-failed' }),
      event({ eventType: 'assistant.text.started', seq: 2, runId: 'run-failed', streamId: 'stream-failed', textId: 'answer-failed', phase: 'answer' }),
      event({
        eventType: 'assistant.text.delta',
        seq: 3,
        runId: 'run-failed',
        streamId: 'stream-failed',
        textId: 'answer-failed',
        phase: 'answer',
        delta: 'Partial failed.',
      }),
      event({
        eventType: 'assistant.text.failed',
        seq: 4,
        runId: 'run-failed',
        streamId: 'stream-failed',
        textId: 'answer-failed',
        phase: 'answer',
        errorCode: 'provider_failed',
        errorMessage: 'Provider failed.',
      }),
      event({
        eventType: 'turn.failed',
        seq: 5,
        runId: 'run-failed',
        streamId: 'stream-failed',
        errorCode: 'provider_failed',
        errorMessage: 'Provider failed.',
        recoverable: true,
      }),
      event({ eventType: 'turn.started', seq: 6, runId: 'run-cancelled', streamId: 'stream-cancelled', userMessageId: 'message-user-cancelled' }),
      event({ eventType: 'assistant.text.started', seq: 7, runId: 'run-cancelled', streamId: 'stream-cancelled', textId: 'answer-cancelled', phase: 'answer' }),
      event({
        eventType: 'assistant.text.delta',
        seq: 8,
        runId: 'run-cancelled',
        streamId: 'stream-cancelled',
        textId: 'answer-cancelled',
        phase: 'answer',
        delta: 'Partial cancelled.',
      }),
      event({
        eventType: 'assistant.text.cancelled_partial',
        seq: 9,
        runId: 'run-cancelled',
        streamId: 'stream-cancelled',
        textId: 'answer-cancelled',
        phase: 'answer',
        reason: 'User stopped the run.',
      }),
      event({
        eventType: 'turn.cancelled',
        seq: 10,
        runId: 'run-cancelled',
        streamId: 'stream-cancelled',
        reason: 'User stopped the run.',
      }),
    ].forEach((chatEvent) => service.publish(chatEvent));

    expect(repository.commitRunTimeline).toHaveBeenCalledTimes(2);

    const failedAssistant = assistantMessage(commits[0]?.messages ?? []);
    expect(processBlock(failedAssistant)).toMatchObject({ status: 'failed' });
    expect(answerBlock(failedAssistant)).toMatchObject({
      status: 'failed',
      text: 'Partial failed.',
    });

    const cancelledAssistant = assistantMessage(commits[1]?.messages ?? []);
    expect(processBlock(cancelledAssistant)).toMatchObject({ status: 'cancelled' });
    expect(answerBlock(cancelledAssistant)).toMatchObject({
      status: 'cancelled_partial',
      text: 'Partial cancelled.',
    });
  });

  it('records diagnostics for persistence failure without publishing synthetic timeline events', () => {
    const { diagnostics, repository } = createRepository({ failCommit: new Error('failed sk-test-secret') });
    const downstream = { publish: vi.fn() };
    const service = new TimelineHistoryCommitProjectorService({
      repository,
      downstream,
      ids: { diagnosticId: () => 'diagnostic-1' },
    });
    const events = [
      event({ eventType: 'turn.started', seq: 1, userMessageId: 'message-user-1' }),
      event({ eventType: 'assistant.text.started', seq: 2, textId: 'answer-1', phase: 'answer' }),
      event({ eventType: 'assistant.text.delta', seq: 3, textId: 'answer-1', phase: 'answer', delta: 'Partial answer.' }),
      event({ eventType: 'assistant.text.completed', seq: 4, textId: 'answer-1', phase: 'answer' }),
      event({ eventType: 'turn.completed', seq: 5 }),
    ];

    events.forEach((chatEvent) => service.publish(chatEvent));

    expect(repository.commitRunTimeline).toHaveBeenCalledTimes(1);
    expect(repository.recordCommitDiagnostic).toHaveBeenCalledTimes(1);
    expect(diagnostics).toEqual([
      {
        diagnosticId: 'diagnostic-1',
        projectId: 'project-1',
        sessionId: 'session-1',
        runId: 'run-1',
        code: 'timeline_commit_failed',
        message: 'Timeline commit failed.',
        createdAt: '2026-05-24T00:00:05.000Z',
      },
    ]);
    expect(diagnostics[0]?.message).not.toContain('sk-test-secret');
    expect(downstream.publish).toHaveBeenCalledTimes(events.length);
    expect(downstream.publish.mock.calls.map(([chatEvent]) => chatEvent)).toEqual(events);
    expect(downstream.publish.mock.calls.map(([chatEvent]) => chatEvent.eventType)).toEqual(
      events.map((chatEvent) => chatEvent.eventType),
    );
  });

  it('ignores duplicate terminal events after a stream has already been committed', () => {
    const { commits, repository } = createRepository();
    const service = new TimelineHistoryCommitProjectorService({
      repository,
      ids: { diagnosticId: () => 'diagnostic-1' },
    });
    const events = [
      event({ eventType: 'turn.started', seq: 1, userMessageId: 'message-user-1' }),
      event({
        eventType: 'user.message.committed',
        seq: 2,
        clientMessageId: 'client-message-1',
        messageId: 'message-user-1',
        text: 'Hello Megumi',
      }),
      event({ eventType: 'assistant.text.started', seq: 3, textId: 'answer-1', phase: 'answer' }),
      event({ eventType: 'assistant.text.delta', seq: 4, textId: 'answer-1', phase: 'answer', delta: 'First answer.' }),
      event({ eventType: 'assistant.text.completed', seq: 5, textId: 'answer-1', phase: 'answer' }),
      event({ eventType: 'turn.completed', seq: 6 }),
    ];

    events.forEach((chatEvent) => service.publish(chatEvent));
    const committedMessages = commits[0]?.messages;
    service.publish(events.at(-1) as ChatStreamEvent);

    expect(repository.commitRunTimeline).toHaveBeenCalledTimes(1);
    expect(commits[0]?.messages).toEqual(committedMessages);
    expect(commits[0]?.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(answerBlock(assistantMessage(commits[0]?.messages ?? []))).toMatchObject({
      status: 'completed',
      text: 'First answer.',
    });
  });

  it('still commits terminal history when downstream publication throws', () => {
    const { commits, repository } = createRepository();
    const service = new TimelineHistoryCommitProjectorService({
      repository,
      downstream: {
        publish: vi.fn(() => {
          throw new Error('renderer closed');
        }),
      },
      ids: { diagnosticId: () => 'diagnostic-1' },
    });
    const events = [
      event({ eventType: 'turn.started', seq: 1, userMessageId: 'message-user-1' }),
      event({ eventType: 'assistant.text.started', seq: 2, textId: 'answer-1', phase: 'answer' }),
      event({ eventType: 'assistant.text.delta', seq: 3, textId: 'answer-1', phase: 'answer', delta: 'Committed anyway.' }),
      event({ eventType: 'assistant.text.completed', seq: 4, textId: 'answer-1', phase: 'answer' }),
      event({ eventType: 'turn.completed', seq: 5 }),
    ];

    events.forEach((chatEvent) => expect(() => service.publish(chatEvent)).not.toThrow());

    expect(repository.commitRunTimeline).toHaveBeenCalledTimes(1);
    expect(answerBlock(assistantMessage(commits[0]?.messages ?? []))).toMatchObject({
      status: 'completed',
      text: 'Committed anyway.',
    });
  });
});


