import { describe, expect, it } from 'vitest';
import { createDatabase } from '@megumi/agent/persistence/connection';
import { applyAgentDatabaseMigrations } from '@megumi/agent/persistence/schema/migrate';
import { WorkspaceRepository } from '@megumi/agent/workspace/repositories/workspace-repository';
import { SessionRepository } from '@megumi/agent/session/repository/session-repository';

function createTestDatabase() {
  const database = createDatabase(':memory:');
  applyAgentDatabaseMigrations(database);
  return database;
}

function seedWorkspace(database: ReturnType<typeof createTestDatabase>): string {
  const workspace = new WorkspaceRepository(database).insertOrUpdateWorkspace({
    workspace_id: 'workspace:session-test',
    name: 'session-test',
    root_path: 'C:/workspaces/session-test',
    root_path_key: 'c:/workspaces/session-test',
    status: 'available',
    created_at: '2026-07-04T00:00:00.000Z',
    updated_at: '2026-07-04T00:00:00.000Z',
    last_opened_at: '2026-07-04T00:00:00.000Z',
  });
  return workspace.workspace_id;
}

describe('SessionRepository', () => {
  it('creates, reads, lists, and archives sessions by workspace', () => {
    const database = createTestDatabase();
    const repository = new SessionRepository(database);
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
    expect(repository.updateSessionArchiveState({
      session_id: 'S1',
      archived_at: '2026-07-04T01:00:00.000Z',
    })?.status).toBe('archived');
  });

  it('saves user message with attachments and a message entry in one transaction', () => {
    const database = createTestDatabase();
    const repository = new SessionRepository(database);
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
      content: [{ type: 'text', text: '看图' }],
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
      created_at: '2026-07-04T00:01:00.000Z',
    }]);
    repository.insertEntry({
      entry_id: 'E1',
      session_id: 'S1',
      entry_type: 'message',
      message_id: 'M1',
      created_at: '2026-07-04T00:01:00.000Z',
    });
    repository.updateActiveEntry({
      session_id: 'S1',
      active_entry_id: 'E1',
      updated_at: '2026-07-04T00:01:00.000Z',
    });

    expect(repository.listMessagesBySessionId('S1')).toEqual([
      expect.objectContaining({
        message_kind: 'user_message', content: [{ type: 'text', text: '看图' }],
      }),
    ]);
    expect(repository.listAttachmentsByMessageIds(['M1'])).toHaveLength(1);
    expect(repository.findSessionById('S1')?.active_entry_id).toBe('E1');
  });

  it('stores compaction summaries without status or token fields', () => {
    const database = createTestDatabase();
    const repository = new SessionRepository(database);
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

    repository.insertCompactionSummary({
      compaction_id: 'C1',
      session_id: 'S1',
      summary_text: 'Summary',
      covered_until_entry_id: 'E1',
      created_at: '2026-07-04T00:02:00.000Z',
    });

    expect(repository.findCompactionSummaryById('C1')?.summary_text).toBe('Summary');
  });
});
