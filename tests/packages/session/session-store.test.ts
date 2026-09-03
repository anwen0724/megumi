import { describe, expect, it } from 'vitest';
import type {
  SessionAssistantReplyMessage,
  UserMessage,
} from '../../../packages/agent/session/src';
import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
} from '../../../packages/agent/database/src/index';
import { createSessionStore } from '@megumi/session/store';

function createTestDatabase() {
  const database = createDatabase({ filename: ':memory:' });
  migrateDatabase({ database });
  return database;
}

function seedWorkspace(database: DatabaseConnection): string {
  database.prepare({ sql: `
    INSERT INTO workspaces (
      workspace_id, name, root_path, root_path_key, status,
      created_at, updated_at, last_opened_at
    ) VALUES (
      'workspace:session-test', 'session-test', 'C:/workspaces/session-test',
      'c:/workspaces/session-test', 'available',
      '2026-07-04T00:00:00.000Z', '2026-07-04T00:00:00.000Z', '2026-07-04T00:00:00.000Z'
    )
  ` }).run();
  return 'workspace:session-test';
}

describe('SessionStore', () => {
  it('creates, reads, lists, and archives sessions by workspace', () => {
    const database = createTestDatabase();
    const repository = createSessionStore({ database });
    const workspaceId = seedWorkspace(database);

    repository.insertSession({
      session_id: 'S1',
      workspace_id: workspaceId,
      title: 'Session',
      status: 'active',
      created_at: '2026-07-04T00:00:00.000Z',
      updated_at: '2026-07-04T00:00:00.000Z',
    });

    expect(repository.findSessionById('S1')?.workspace_id).toBe(workspaceId);
    expect(repository.listSessionsByWorkspaceId(workspaceId)).toHaveLength(1);
    expect(repository.archiveSession({
      session_id: 'S1',
      archived_at: '2026-07-04T01:00:00.000Z',
    })?.status).toBe('archived');
  });

  it('saves user message with attachments and a message entry in one transaction', () => {
    const database = createTestDatabase();
    const repository = createSessionStore({ database });
    const workspaceId = seedWorkspace(database);
    repository.insertSession({
      session_id: 'S1',
      workspace_id: workspaceId,
      title: 'Session',
      status: 'active',
      created_at: '2026-07-04T00:00:00.000Z',
      updated_at: '2026-07-04T00:00:00.000Z',
    });

    repository.insertMessage({
      message_id: 'M1',
      session_id: 'S1',
      message_kind: 'user_message',
      display_content: [{ type: 'text', text: '看图' }], model_content: [{ type: 'text', text: '看图' }],
      created_at: '2026-07-04T00:01:00.000Z',
      completed_at: '2026-07-04T00:01:00.000Z',
    });
    repository.insertMessageAttachments([{
      attachment_id: 'A1',
      message_id: 'M1',
      session_id: 'S1',
      type: 'image',
      name: 'error.png',
      mime_type: 'image/png',
      source_type: 'local_file',
      source_value: 'C:/tmp/error.png',
      ordinal: 0,
      created_at: '2026-07-04T00:01:00.000Z',
    }]);
    repository.insertEntry({
      entry_id: 'E1',
      session_id: 'S1',
      entry_type: 'message',
      message_id: 'M1',
      created_at: '2026-07-04T00:01:00.000Z',
    });
    repository.updateSessionActiveEntry({
      session_id: 'S1',
      active_entry_id: 'E1',
      updated_at: '2026-07-04T00:01:00.000Z',
    });

    expect(repository.listMessagesBySessionId('S1')).toEqual([
      expect.objectContaining({
        message_kind: 'user_message', display_content: [{ type: 'text', text: '看图' }], model_content: [{ type: 'text', text: '看图' }],
      }),
    ]);
    expect(repository.listAttachmentsByMessageIds(['M1'])).toHaveLength(1);
    expect(repository.findMessageEntryBySessionIdAndMessageId({
      session_id: 'S1',
      message_id: 'M1',
    })?.entry_id).toBe('E1');
    expect(repository.findSessionById('S1')?.active_entry_id).toBe('E1');
  });

  it('stores Compaction lifecycle records and reads completed summaries by id', () => {
    const database = createTestDatabase();
    const repository = createSessionStore({ database });
    const workspaceId = seedWorkspace(database);
    repository.insertSession({
      session_id: 'S1',
      workspace_id: workspaceId,
      title: 'Session',
      status: 'active',
      created_at: '2026-07-04T00:00:00.000Z',
      updated_at: '2026-07-04T00:00:00.000Z',
    });
    repository.insertEntry({
      entry_id: 'E1',
      session_id: 'S1',
      entry_type: 'message',
      message_id: 'M1',
      created_at: '2026-07-04T00:01:00.000Z',
    });

    repository.insertCompaction({
      compactionId: 'C1',
      sessionId: 'S1',
      anchorEntryId: 'E1',
      trigger: 'manual',
      status: 'running',
      startedAt: '2026-07-04T00:02:00.000Z',
    });
    repository.updateCompaction({
      compactionId: 'C1',
      sessionId: 'S1',
      anchorEntryId: 'E1',
      trigger: 'manual',
      status: 'completed',
      summary: {
        compaction_id: 'C1',
        session_id: 'S1',
        summary_text: 'Summary',
        covered_until_entry_id: 'E1',
        created_at: '2026-07-04T00:03:00.000Z',
      },
      startedAt: '2026-07-04T00:02:00.000Z',
      completedAt: '2026-07-04T00:03:00.000Z',
    });

    expect(repository.findCompactionById('C1')?.summary?.summary_text).toBe('Summary');
    expect(repository.listCompletedCompactionSummariesByIds(['C1'])).toEqual([
      expect.objectContaining({ compaction_id: 'C1', summary_text: 'Summary' }),
    ]);
  });

  it('returns precise Message variants from kind-specific queries', () => {
    const database = createTestDatabase();
    const repository = createSessionStore({ database });
    const workspaceId = seedWorkspace(database);
    repository.insertSession({
      session_id: 'S1',
      workspace_id: workspaceId,
      title: 'Session',
      status: 'active',
      created_at: '2026-07-04T00:00:00.000Z',
      updated_at: '2026-07-04T00:00:00.000Z',
    });
    repository.insertMessage({
      message_id: 'U1', session_id: 'S1', execution_id: 'R1',
      message_kind: 'user_message', display_content: [], model_content: [],
      created_at: '2026-07-04T00:01:00.000Z',
    });
    repository.insertMessage({
      message_id: 'A1', session_id: 'S1', execution_id: 'R1',
      message_kind: 'assistant_reply', status: 'completed', reason_code: 'normal_completion',
      content: [{ type: 'text', text: 'done' }],
      created_at: '2026-07-04T00:02:00.000Z',
      completed_at: '2026-07-04T00:02:00.000Z',
    });

    const reply: SessionAssistantReplyMessage | undefined =
      repository.findAssistantReplyBySessionIdAndExecutionId({
        session_id: 'S1',
        execution_id: 'R1',
      });
    const users: UserMessage[] = repository.listUserMessagesByExecutionIds(['R1']);

    expect(reply?.message_kind).toBe('assistant_reply');
    expect(users.map((message) => message.message_kind)).toEqual(['user_message']);
  });

  it('does not expose removed raw or legacy queries', () => {
    const database = createTestDatabase();
    const repository = createSessionStore({ database }) as unknown as Record<string, unknown>;

    expect(repository).not.toHaveProperty('listMessagesByExecutionId');
    expect(repository).not.toHaveProperty('insertCompactionSummary');
    expect(repository).not.toHaveProperty('findCompactionSummaryById');
    expect(repository).not.toHaveProperty('listCompactionSummariesBySessionId');
  });
});
