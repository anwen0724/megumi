// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import {
  openSqliteDatabase,
  runDatabaseMigrations,
  SqliteTimelineMessageRepository,
  type SqliteDatabase,
} from '../../../src/database';
import type { TimelineAssistantMessage, TimelineUserMessage } from '../../../src/shared/renderer-contracts/timeline';

let database: SqliteDatabase | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

function createRepository(): SqliteTimelineMessageRepository {
  database = openSqliteDatabase(':memory:');
  runDatabaseMigrations(database, { now: () => '2026-06-20T00:00:00.000Z' });
  database.prepare(`
    INSERT INTO sessions (id, title, status, created_at, updated_at)
    VALUES ('session-1', 'New session', 'active', '2026-06-20T00:00:00.000Z', '2026-06-20T00:00:00.000Z')
  `).run();
  return new SqliteTimelineMessageRepository(database);
}

const userMessage: TimelineUserMessage = {
  messageId: 'session-message-user-1',
  role: 'user',
  projectId: 'workspace-1',
  sessionId: 'session-1',
  runId: 'run-1',
  clientMessageId: 'client-message-1',
  turnOrder: 0,
  createdAt: '2026-06-20T00:00:00.000Z',
  updatedAt: '2026-06-20T00:00:00.000Z',
  blocks: [{ blockId: 'user-text:session-message-user-1', kind: 'user_text', text: 'hello', format: 'plain' }],
};

const assistantMessage: TimelineAssistantMessage = {
  messageId: 'assistant:run-1',
  role: 'assistant',
  projectId: 'workspace-1',
  sessionId: 'session-1',
  runId: 'run-1',
  turnOrder: 1,
  createdAt: '2026-06-20T00:00:01.000Z',
  updatedAt: '2026-06-20T00:00:02.000Z',
  blocks: [
    {
      blockId: 'process:run-1',
      kind: 'process_disclosure',
      runId: 'run-1',
      status: 'completed',
      startedAt: '2026-06-20T00:00:01.000Z',
      endedAt: '2026-06-20T00:00:02.000Z',
      items: [],
    },
    {
      blockId: 'answer:run-1',
      kind: 'answer_text',
      runId: 'run-1',
      textId: 'answer-1',
      status: 'completed',
      text: 'pong',
      format: 'markdown',
    },
  ],
};

describe('SqliteTimelineMessageRepository', () => {
  it('commits and hydrates canonical timeline messages in stable order', () => {
    const repository = createRepository();

    repository.commitRunTimeline({
      projectId: 'workspace-1',
      sessionId: 'session-1',
      runId: 'run-1',
      committedAt: '2026-06-20T00:00:03.000Z',
      messages: [assistantMessage, userMessage],
      sessionPreview: 'pong',
    });

    expect(repository.listCommittedMessagesBySession({ projectId: 'workspace-1', sessionId: 'session-1' })).toEqual({
      messages: [userMessage, assistantMessage],
      diagnostics: [],
    });
    expect(repository.getRunCommit('run-1')).toMatchObject({
      runId: 'run-1',
      projectId: 'workspace-1',
      sessionId: 'session-1',
      status: 'committed',
      committedAt: '2026-06-20T00:00:03.000Z',
    });
  });

  it('rejects timeline messages outside the committed run ownership', () => {
    const repository = createRepository();

    expect(() => repository.commitRunTimeline({
      projectId: 'workspace-1',
      sessionId: 'session-1',
      runId: 'run-1',
      committedAt: '2026-06-20T00:00:03.000Z',
      messages: [{ ...assistantMessage, runId: 'run-other' }],
    })).toThrow(/Timeline commit message ownership mismatch/);

    expect(repository.listCommittedMessagesBySession({ projectId: 'workspace-1', sessionId: 'session-1' }).messages).toEqual([]);
  });

  it('records commit diagnostics without exposing raw failure details', () => {
    const repository = createRepository();

    repository.recordCommitDiagnostic({
      diagnosticId: 'diagnostic-1',
      projectId: 'workspace-1',
      sessionId: 'session-1',
      runId: 'run-1',
      code: 'timeline_commit_failed',
      message: 'Timeline commit failed.',
      createdAt: '2026-06-20T00:00:03.000Z',
    });

    expect(repository.getRunCommit('run-1')).toMatchObject({
      runId: 'run-1',
      status: 'failed',
      error: { code: 'timeline_commit_failed', message: 'Timeline commit failed.' },
    });
    expect(repository.listCommitDiagnostics('run-1')).toEqual([
      expect.objectContaining({ diagnosticId: 'diagnostic-1', code: 'timeline_commit_failed' }),
    ]);
  });
});
