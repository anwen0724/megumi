import { describe, expect, it } from 'vitest';
import { createSessionService } from '@megumi/coding-agent/session';
import { createDatabase } from '@megumi/coding-agent/persistence/connection';
import { applyCodingAgentDatabaseMigrations } from '@megumi/coding-agent/persistence/schema/migrate';
import { WorkspaceRepository } from '@megumi/coding-agent/workspace/repositories/workspace-repository';
import { SessionRepository } from '@megumi/coding-agent/session/repositories/session-repository';

function createTestDatabase() {
  const database = createDatabase(':memory:');
  applyCodingAgentDatabaseMigrations(database);
  return database;
}

function seedWorkspace(database: ReturnType<typeof createTestDatabase>): string {
  const workspace = new WorkspaceRepository(database).insertOrUpdateWorkspace({
    workspace_id: 'workspace:session-flow-test',
    name: 'session-flow-test',
    root_path: 'C:/workspaces/session-flow-test',
    root_path_key: 'c:/workspaces/session-flow-test',
    status: 'available',
    created_at: '2026-07-04T00:00:00.000Z',
    updated_at: '2026-07-04T00:00:00.000Z',
    last_opened_at: '2026-07-04T00:00:00.000Z',
  });
  return workspace.workspace_id;
}

function createHarness() {
  const database = createTestDatabase();
  const workspaceId = seedWorkspace(database);
  const repository = new SessionRepository(database);
  const service = createSessionService({
    repository,
    ids: {
      sessionId: () => 'S1',
      entryId: ({ kind, source_id }) => `${kind}:${source_id}`,
    },
    now: () => '2026-07-04T00:00:00.000Z',
  });
  return { repository, service, workspaceId };
}

describe('session service flows', () => {
  it('creates a branch by switching active entry and saving a new message', async () => {
    const { service, workspaceId } = createHarness();
    service.createSession({ workspace_id: workspaceId, title: 'Session' });
    const m1 = service.saveUserMessage({ message_id: 'M1', session_id: 'S1', content_text: 'm1', created_at: '2026-07-04T00:01:00.000Z' });
    service.saveAssistantMessage({ message_id: 'M2', session_id: 'S1', run_id: 'R1', content_text: 'm2', completed_at: '2026-07-04T00:02:00.000Z' });
    service.saveUserMessage({ message_id: 'M3', session_id: 'S1', content_text: 'm3', created_at: '2026-07-04T00:03:00.000Z' });

    const branchPoint = m1.status === 'saved' ? m1.entry.entry_id : undefined;
    service.switchActiveEntry({ session_id: 'S1', active_entry_id: branchPoint, updated_at: '2026-07-04T00:04:00.000Z' });
    service.saveUserMessage({ message_id: 'M4', session_id: 'S1', content_text: 'm4', created_at: '2026-07-04T00:05:00.000Z' });

    const result = service.listMessages({ session_id: 'S1', active_path_only: true });

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.messages.map((item) => item.message.message_id)).toEqual(['M1', 'M4']);
    }
  });

  it('creates a branch by saving the next user message under an explicit parent entry', async () => {
    const { service, workspaceId } = createHarness();
    service.createSession({ workspace_id: workspaceId, title: 'Session' });
    service.saveUserMessage({ message_id: 'U1', session_id: 'S1', content_text: 'u1', created_at: '2026-07-04T00:01:00.000Z' });
    const a1 = service.saveAssistantMessage({ message_id: 'A1', session_id: 'S1', run_id: 'R1', content_text: 'a1', completed_at: '2026-07-04T00:02:00.000Z' });
    service.saveUserMessage({ message_id: 'U2', session_id: 'S1', content_text: 'u2', created_at: '2026-07-04T00:03:00.000Z' });
    service.saveAssistantMessage({ message_id: 'A2', session_id: 'S1', run_id: 'R2', content_text: 'a2', completed_at: '2026-07-04T00:04:00.000Z' });

    service.saveUserMessage({
      message_id: 'U3',
      session_id: 'S1',
      content_text: 'u3',
      parent_entry_id: a1.status === 'saved' ? a1.entry.entry_id : 'missing',
      created_at: '2026-07-04T00:05:00.000Z',
    });

    const result = service.listMessages({ session_id: 'S1', active_path_only: true });

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.messages.map((item) => item.message.message_id)).toEqual(['U1', 'A1', 'U3']);
    }
  });

  it('uses compaction summary in active history and skips it in active message listing', async () => {
    const { service, workspaceId } = createHarness();
    service.createSession({ workspace_id: workspaceId, title: 'Session' });
    const m1 = service.saveUserMessage({ message_id: 'M1', session_id: 'S1', content_text: 'm1', created_at: '2026-07-04T00:01:00.000Z' });
    const m2 = service.saveAssistantMessage({ message_id: 'M2', session_id: 'S1', run_id: 'R1', content_text: 'm2', completed_at: '2026-07-04T00:02:00.000Z' });
    const firstKeptEntryId = m2.status === 'saved' ? m2.entry.entry_id : undefined;
    service.saveCompactionSummary({
      compaction_id: 'C1',
      session_id: 'S1',
      summary_text: 'm1 summary',
      covered_until_entry_id: m1.status === 'saved' ? m1.entry.entry_id : 'missing',
      first_kept_entry_id: firstKeptEntryId,
      created_at: '2026-07-04T00:03:00.000Z',
      append_to_active_path: true,
    });

    const activeMessages = service.listMessages({ session_id: 'S1', active_path_only: true });
    const activeHistory = service.getActiveHistory({ session_id: 'S1' });

    expect(activeMessages.status).toBe('ok');
    if (activeMessages.status === 'ok') {
      expect(activeMessages.messages.map((item) => item.message.message_id)).toEqual(['M2']);
    }
    expect(activeHistory.status).toBe('ok');
    if (activeHistory.status === 'ok') {
      expect(activeHistory.history.map((item) => item.type)).toEqual(['compaction', 'message']);
    }
  });
});
